const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");
const { log } = require("console");

const urls = [
  "https://en.wikipedia.org/wiki/Computer",
  "https://en.wikipedia.org/wiki/Science",
  "https://en.wikipedia.org/wiki/Phone",
  // "https://en.wikipedia.org/wiki/Book",
];

const nameNodeUrl = "http://namenode:4000";

const crawler = async () => {
  log("Crawler started.");
  try {
    await fs.promises.mkdir("../dfs", { recursive: true });
    for (let i = 0; i < urls.length; i++) {
      try {
        log(`Fetching ${urls[i]}...`);
        const res = await axios.get(urls[i]);
        log(`Fetched ${urls[i]} with StatusCode: ${res.status}`);
        const $ = cheerio.load(res.data);
        const bodyContent = $("body").text();
        const filePath = `../dfs/split${i + 1}.txt`;
        await fs.promises.writeFile(filePath, bodyContent);
        const response = await axios.post(`${nameNodeUrl}/register`, { fileName: `split${i+1}.txt` });
        console.log("[POST] ", response.data.files);

        log(`Successfully wrote to ${filePath}`);
      } catch (err) {
        log(`Error processing ${urls[i]}: ${err.message}`);
      }
    }
    log("Crawler finished.");
  } catch (err) {
    log(`Crawler encountered a fatal error: ${err.message}`);
  }
};

(async () => {
  await crawler();
})();
