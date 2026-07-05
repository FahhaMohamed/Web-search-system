//! Native text index for the Search Node.
//!
//! Exposes a small class to Node.js that wraps Tantivy (a Rust
//! inverted-index library — the Rust-ecosystem equivalent of Lucene).
//! Only the hot loop lives here; the rest of the Search Node stays
//! in JavaScript.
//!
//! Interface mirrors the old pure-JS TextIndex:
//!   - new NativeTextIndex(fields)   → build a schema over the given text fields
//!   - add(id, docObj)               → add one document
//!   - commit()                      → flush + reload reader (idempotent)
//!   - search(query, limit)          → returns [{ id, score }]

use std::collections::HashMap;
use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, Schema, Value, STORED, STRING, TEXT};
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, TantivyDocument};

const WRITER_HEAP_BYTES: usize = 50_000_000; // 50MB — Tantivy's minimum recommendation

#[napi(object)]
pub struct SearchHit {
    pub id: String,
    pub score: f64,
}

#[napi]
pub struct NativeTextIndex {
    index: Index,
    // Writer is guarded by a mutex — Tantivy's IndexWriter is not Sync,
    // and napi may share references across worker threads.
    writer: Mutex<IndexWriter>,
    reader: IndexReader,
    id_field: Field,
    text_fields: Vec<Field>,
    text_field_names: Vec<String>,
    text_field_map: HashMap<String, Field>,
    // Track whether writes are pending so commit() is cheap when clean.
    dirty: Mutex<bool>,
}

#[napi]
impl NativeTextIndex {
    #[napi(constructor)]
    pub fn new(fields: Vec<String>) -> Result<Self> {
        if fields.is_empty() {
            return Err(Error::from_reason("at least one text field is required"));
        }
        let mut schema_builder = Schema::builder();
        // _id is stored so we can return it in search hits. STRING = not tokenized.
        let id_field = schema_builder.add_text_field("_id", STRING | STORED);
        let mut text_fields = Vec::with_capacity(fields.len());
        let mut text_field_map = HashMap::with_capacity(fields.len());
        for name in &fields {
            let f = schema_builder.add_text_field(name, TEXT);
            text_fields.push(f);
            text_field_map.insert(name.clone(), f);
        }
        let schema = schema_builder.build();
        let index = Index::create_in_ram(schema);
        let writer = index
            .writer(WRITER_HEAP_BYTES)
            .map_err(|e| Error::from_reason(format!("tantivy writer create failed: {e}")))?;
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()
            .map_err(|e| Error::from_reason(format!("tantivy reader create failed: {e}")))?;
        Ok(Self {
            index,
            writer: Mutex::new(writer),
            reader,
            id_field,
            text_fields,
            text_field_names: fields,
            text_field_map,
            dirty: Mutex::new(false),
        })
    }

    /// Add one document. `doc_obj` may contain text values for any subset of
    /// the configured fields — missing fields are simply omitted.
    #[napi]
    pub fn add(&self, id: String, doc_obj: Object) -> Result<()> {
        let mut td = TantivyDocument::default();
        td.add_text(self.id_field, &id);
        for name in &self.text_field_names {
            let field = self.text_field_map[name];
            let key = name.as_str();
            // Try to read as string first, then fall back to array of strings joined.
            if let Ok(Some(s)) = doc_obj.get::<_, String>(key) {
                if !s.is_empty() {
                    td.add_text(field, &s);
                }
                continue;
            }
            if let Ok(Some(arr)) = doc_obj.get::<_, Vec<String>>(key) {
                if !arr.is_empty() {
                    td.add_text(field, &arr.join(" "));
                }
            }
        }
        let writer = self
            .writer
            .lock()
            .map_err(|_| Error::from_reason("writer mutex poisoned"))?;
        writer
            .add_document(td)
            .map_err(|e| Error::from_reason(format!("add_document failed: {e}")))?;
        let mut dirty = self
            .dirty
            .lock()
            .map_err(|_| Error::from_reason("dirty mutex poisoned"))?;
        *dirty = true;
        Ok(())
    }

    /// Flush pending writes and reload the reader so new docs are searchable.
    /// Cheap no-op if no writes have happened since the last commit.
    #[napi]
    pub fn commit(&self) -> Result<()> {
        let mut dirty = self
            .dirty
            .lock()
            .map_err(|_| Error::from_reason("dirty mutex poisoned"))?;
        if !*dirty {
            return Ok(());
        }
        {
            let mut writer = self
                .writer
                .lock()
                .map_err(|_| Error::from_reason("writer mutex poisoned"))?;
            writer
                .commit()
                .map_err(|e| Error::from_reason(format!("commit failed: {e}")))?;
        }
        self.reader
            .reload()
            .map_err(|e| Error::from_reason(format!("reader reload failed: {e}")))?;
        *dirty = false;
        Ok(())
    }

    /// Search the index. Returns up to `limit` hits, ranked by score (highest
    /// first). Query syntax is Tantivy's default parser (whitespace-tokenized,
    /// per-term OR across all text fields).
    #[napi]
    pub fn search(&self, query: String, limit: u32) -> Result<Vec<SearchHit>> {
        // Auto-commit if callers forgot — cheap when clean.
        {
            let dirty = self
                .dirty
                .lock()
                .map_err(|_| Error::from_reason("dirty mutex poisoned"))?;
            let needs_commit = *dirty;
            drop(dirty);
            if needs_commit {
                self.commit()?;
            }
        }
        let searcher = self.reader.searcher();
        let query_parser = QueryParser::for_index(&self.index, self.text_fields.clone());
        // If the parser can't handle the input, treat it as an empty query
        // rather than throwing — the caller gets zero hits, same as when
        // no docs match.
        let parsed = match query_parser.parse_query(&query) {
            Ok(q) => q,
            Err(_) => return Ok(Vec::new()),
        };
        let top_docs = searcher
            .search(&parsed, &TopDocs::with_limit(limit as usize))
            .map_err(|e| Error::from_reason(format!("search failed: {e}")))?;
        let mut hits = Vec::with_capacity(top_docs.len());
        for (score, doc_addr) in top_docs {
            let d: TantivyDocument = searcher
                .doc(doc_addr)
                .map_err(|e| Error::from_reason(format!("doc fetch failed: {e}")))?;
            let id = d
                .get_first(self.id_field)
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            hits.push(SearchHit { id, score: score as f64 });
        }
        Ok(hits)
    }
}
