const fs = require('fs');
const path = require('path');

class FileStorage {
    constructor(filePath) {
        this.filePath = filePath;
    }

    read() {
        if (!fs.existsSync(this.filePath)) {
            return {};
        }
        const raw = fs.readFileSync(this.filePath, 'utf8');
        return JSON.parse(raw);
    }

    write(obj) {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf8');
    }
}

module.exports = { FileStorage };
