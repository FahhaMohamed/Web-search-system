const fs = require("fs");
const path = require("path");

const dfsDir = path.join(__dirname, "../dfs");
let files;
try {
  files = fs.readdirSync(dfsDir).filter(f => f.startsWith("map-"));
  if (files.length === 0) {
    console.error("No map files found in dfs directory.");
    process.exit(1);
  }
} catch (err) {
  console.error(`Error reading dfs directory: ${err.message}`);
  process.exit(1);
}

const index = {};

files.forEach(file => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dfsDir, file)));
    for (const word in data) {
      if (!index[word]) index[word] = new Set();
      data[word].forEach(f => index[word].add(f));
    }
  } catch (err) {
    console.error(`Error processing file ${file}: ${err.message}`);
  }
});

const result = {};
for (const word in index) {
  result[word] = Array.from(index[word]);
}

try {
  fs.writeFileSync(path.join(dfsDir, "index.json"), JSON.stringify(result, null, 2));
  console.log("Index file created: " + path.join(dfsDir, "index.json"));
} catch (err) {
  console.error(`Error writing index.json: ${err.message}`);
  process.exit(1);
}
