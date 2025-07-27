const express = require("express");
const app = express();

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
