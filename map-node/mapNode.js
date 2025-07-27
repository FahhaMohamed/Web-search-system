const fs = require("fs");
const path = require("path");
const axios = require("axios");

// const inputFile = process.argv[2];

const nameNodeUrl = "http://namenode:4000";
const workerId = `map-worker-${Math.random().toString(36).substring(7)}`;

async function getTask() {
  try {
    const response = await axios.get(
      `${nameNodeUrl}/getTask?workerId=${workerId}`
    );

    return response.data.fileName;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log("[Error] No more tasks available.");
      return null;
    }
    console.error("[Error] fetching task from NameNode:", error.message);
    return null;
  }
}

(async () => {
  while (true) {
    const inputFile = await getTask();
    if (!inputFile) {
      console.log("[Error]: No input file specified.");
      return;
    }

    const inputPath = path.join(__dirname, "../dfs", inputFile);
    const outputPath = path.join(__dirname, "../dfs", `map-${inputFile}`);
    try {
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
  }
})();
