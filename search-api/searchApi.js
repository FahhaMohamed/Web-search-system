const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();

let index = {};
const indexPath = "/dfs/index.json";
try {
  index = JSON.parse(fs.readFileSync(indexPath));
  console.log("Index loaded successfully.");
} catch (err) {
  console.error(`Failed to load index: ${err.message}`);
}

app.get("/search", (req, res) => {
  const q = req.query.q;
  if (!q) {
    return res.status(400).json({
      status: false,
      message: "Missing query parameter 'q'",
      result: {}
    });
  }
  const key = q.toLowerCase();
  if (index[key]) {
    res.json({
      status: true,
      message: "Successfully fetched the result.",
      results: index[key]
    });
  } else {
    res.json({
      status: true,
      message: "No results found.",
      results: []
    });
  }
});

app.listen(3000, () => console.log("Search API running on port 3000"));