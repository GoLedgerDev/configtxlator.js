const fs = require('fs-extra');

module.exports.update = function updateProtos() {
    const hasFabProtosFolder = fs.existsSync("fabprotos");
    if (hasFabProtosFolder) {
        console.log("fabprotos folder found, unlinking it...");
        fs.removeSync("fabprotos");
    } else {
        console.log("no fabprotos found, creating it...");
    }
    fs.mkdir("fabprotos", (err) => {
        if (err) {
            console.log("Could not recreate folder fabprotos, err: ", err.message);
            throw err;
        }
    });

    const hasNodeProtos = fs.existsSync("./node_modules/fabric-protos");
    if (hasNodeProtos) {
        fs.copy("node_modules/fabric-protos/google-protos/google", "fabprotos/google");
        const protoFolders = fs.readdirSync("node_modules/fabric-protos/protos");
        protoFolders.forEach((folder) => {
            fs.copy(`node_modules/fabric-protos/protos/${folder}`, `fabprotos/${folder}`);
        });
        console.log("Finished!");
    } else {
        console.error("no node_modules/fabric-protos found, did you run \"npm install\"?");
        return;
    }
}