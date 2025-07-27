const fs = require("fs");
const path = require("path");
const axios = require("axios");

const inputFile = process.argv[2];

const nameNodeUrl = "http://namenode:4000";

if (!inputFile) {
  console.error("Error: No input file specified.");
  process.exit(1);
}

const inputPath = path.join(__dirname, "../dfs", inputFile);
const outputPath = path.join(__dirname, "../dfs", `map-${inputFile}`);

(async () => {
  try {
    const response = await axios.get(`${nameNodeUrl}/success`);
    console.log("[GET] ", response.data.message);

    const text = fs.readFileSync(inputPath, "utf-8");
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const output = {};

    words.forEach((word) => {
      if (!output[word]) {
        output[word] = [];
      }
      output[word].push(inputFile);
    });

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`Map file created: ${outputPath}`);
  } catch (err) {
    console.error(`Error processing file: ${err.message}`);
    process.exit(1);
  }
})();
