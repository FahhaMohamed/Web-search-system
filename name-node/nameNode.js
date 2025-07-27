const express = require('express');
const app = express();


app.get("/success", (req, res) => {
    res.json({
        status: true,
        message: "Response from name-node success endpoint.",
     
    });
});

app.listen(4000, ()=> {
    console.log("Name Node running on port 4000");
})