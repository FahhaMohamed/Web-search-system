const fs = require('fs');
const path = require('path');

const inputFile = process.argv[2];

if (!inputFile) {
    console.error('Error: No input file specified.');
    process.exit(1);
}

const inputPath = path.join(__dirname, '../dfs', inputFile);
const outputPath = path.join(__dirname, '../dfs', `map-${inputFile}`);

try {
    const text = fs.readFileSync(inputPath, 'utf-8');
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    const output = {};

    words.forEach(word => {
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