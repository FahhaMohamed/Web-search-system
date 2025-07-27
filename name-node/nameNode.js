const express = require("express");
const app = express();
app.use(express.json());

const metaData = {
  files: [],
  processedFiles: new Set(),
  mapFileToWorker: {},
};

// Endpoint for the crawler to register a new file
app.post("/register", (req, res) => {
  const { fileName } = req.body;
  if (fileName && !metaData.files.includes(fileName)) {
    metaData.files.push(fileName);
    console.log(`✅ Registered file: ${fileName}`);
    res.status(201).json({
      status: true,
      message: "File successfully registered.",
      files: metaData.files,
    });
  } else {
    res.status(400).json({
      status: false,
      message: "Invalid file name or file already registered.",
    });
  }
});

// Endpoint for a map node to request a file to process
app.get("/getTask", (req, res) => {
  const availableFile = metaData.files.find(
    (file) =>
      !metaData.processedFiles.has(file) &&
      !Object.values(metaData.mapFileToWorker).includes(file)
  );

  if (availableFile) {
    const workerId = req.query.workerId;
    metaData.mapFileToWorker[workerId] = availableFile;
    metaData.processedFiles.add(availableFile);
    console.log(`✅ Assigned file ${availableFile} to worker ${workerId}`);
    console.log(`✅ Assigned Works: ${JSON.stringify(metaData.mapFileToWorker)}`);
    res.status(200).json({
      status: true,
      message: `File successfully assigned to worker ${workerId}`,
      fileName: availableFile,
    });
  } else {
    console.log("❌ No available files to process.");

    res
      .status(404)
      .json({ status: true, message: "No available files to process." });
  }
});

// Endpoint for Testing
app.get("/success", (req, res) => {
  console.log("✅ GET /success hit from:", req.ip);
  return res.status(200).json({
    status: true,
    message:
      "Response success: Name node API working with docker successfully.",
  });
});

app.listen(4000, () => {
  console.log("Name node running on port: 4000");
});
