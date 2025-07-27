const fs = require('fs');
const path = require('path');

const folderPath = '/dfs'; // inside container

function deleteFolderContents(folderPath) {
  if (fs.existsSync(folderPath)) {
    fs.readdirSync(folderPath).forEach((file) => {
      const curPath = path.join(folderPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        fs.rmSync(curPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(curPath);
      }
    });
    console.log(`✅ Contents of '${folderPath}' deleted successfully.`);
  } else {
    console.log(`❌ Folder '${folderPath}' does not exist.`);
  }
}

deleteFolderContents(folderPath);
