const fs = require('fs');
const path = require('path');
const { FileStorage } = require('../storage');

const TEST_FILE = path.join(__dirname, 'tmp-storage.json');

describe('FileStorage', () => {
    beforeEach(() => {
        if (fs.existsSync(TEST_FILE)) {
            fs.unlinkSync(TEST_FILE);
        }
    });

    afterAll(() => {
        if (fs.existsSync(TEST_FILE)) {
            fs.unlinkSync(TEST_FILE);
        }
    });

    test('write() then read() returns the same object', () => {
        const storage = new FileStorage(TEST_FILE);
        storage.write({ a: 1, b: 'hello' });
        expect(storage.read()).toEqual({ a: 1, b: 'hello' });
    });

    test('read() returns empty object when file does not exist', () => {
        const storage = new FileStorage(TEST_FILE);
        expect(storage.read()).toEqual({});
    });

    test('write() creates parent directory if missing', () => {
        const nestedFile = path.join(__dirname, 'tmp-nested', 'data.json');
        const storage = new FileStorage(nestedFile);
        storage.write({ x: 1 });
        expect(fs.existsSync(nestedFile)).toBe(true);
        fs.unlinkSync(nestedFile);
        fs.rmdirSync(path.dirname(nestedFile));
    });
});
