"use strict";
/// <reference types="node" />
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const client_s3_1 = require("@aws-sdk/client-s3");
dotenv.config({ path: path.resolve(__dirname, "../.env") });
const ROOT_FOLDER_NAME = "newaryan";
function askQuestion(rl, prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, (answer) => resolve(answer));
    });
}
function normalizeEndpoint(endpoint) {
    return endpoint.replace(/\/+$/, "");
}
function sanitizeFolderName(value) {
    return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, "-");
}
function getContentTypeFromExtension(ext) {
    switch (ext.toLowerCase()) {
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".png":
            return "image/png";
        case ".webp":
            return "image/webp";
        case ".gif":
            return "image/gif";
        case ".bmp":
            return "image/bmp";
        case ".svg":
            return "image/svg+xml";
        case ".avif":
            return "image/avif";
        default:
            return "application/octet-stream";
    }
}
function isSupportedImageFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg", ".avif"].includes(ext);
}
function buildZataClient() {
    const bucket = process.env.ZATA_BUCKET || "devstoragev1";
    const endpoint = process.env.ZATA_ENDPOINT || "";
    const region = process.env.ZATA_REGION || "us-east-1";
    const accessKeyId = process.env.ZATA_ACCESS_KEY_ID || "";
    const secretAccessKey = process.env.ZATA_SECRET_ACCESS_KEY || "";
    if (!endpoint) {
        throw new Error("ZATA_ENDPOINT is not set in .env.");
    }
    if (!accessKeyId || !secretAccessKey) {
        throw new Error("ZATA credentials are missing. Set ZATA_ACCESS_KEY_ID and ZATA_SECRET_ACCESS_KEY in .env.");
    }
    const client = new client_s3_1.S3Client({
        endpoint,
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
        forcePathStyle: String(process.env.ZATA_FORCE_PATH_STYLE).toLowerCase() === "true",
    });
    return { client, bucket, endpoint };
}
function collectImageFiles(inputPath) {
    const resolvedPath = path.resolve(inputPath.replace(/^['"]|['"]$/g, ""));
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Path not found: ${resolvedPath}`);
    }
    const stat = fs.statSync(resolvedPath);
    if (stat.isFile()) {
        if (!isSupportedImageFile(resolvedPath)) {
            throw new Error(`Unsupported image file: ${resolvedPath}`);
        }
        return [resolvedPath];
    }
    if (!stat.isDirectory()) {
        throw new Error(`Path is neither a file nor a folder: ${resolvedPath}`);
    }
    const files = fs
        .readdirSync(resolvedPath)
        .map((name) => path.join(resolvedPath, name))
        .filter((filePath) => fs.statSync(filePath).isFile() && isSupportedImageFile(filePath));
    if (files.length === 0) {
        throw new Error(`No supported image files found inside: ${resolvedPath}`);
    }
    return files;
}
async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    try {
        const { client: s3, bucket, endpoint } = buildZataClient();
        const folderName = sanitizeFolderName(await askQuestion(rl, `Enter the folder name inside ${ROOT_FOLDER_NAME} to upload into: `));
        if (!folderName) {
            throw new Error("Folder name is required.");
        }
        const sourcePath = await askQuestion(rl, "Enter the local image file path or local folder path containing images: ");
        const files = collectImageFiles(sourcePath);
        const targetPrefix = `${ROOT_FOLDER_NAME}/${folderName}/image`;
        console.log("");
        console.log(`Uploading ${files.length} image(s) to ${normalizeEndpoint(endpoint)}/${bucket}/${targetPrefix}/`);
        const uploadedUrls = [];
        for (const filePath of files) {
            const fileName = path.basename(filePath);
            const key = `${targetPrefix}/${fileName}`;
            const buffer = await fs.promises.readFile(filePath);
            await s3.send(new client_s3_1.PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: buffer,
                ContentType: getContentTypeFromExtension(path.extname(fileName)),
            }));
            const publicUrl = `${normalizeEndpoint(endpoint)}/${bucket}/${encodeURI(key)}`;
            uploadedUrls.push(publicUrl);
            console.log(`Uploaded: ${fileName}`);
            console.log(`URL: ${publicUrl}`);
            console.log("");
        }
        console.log("Upload complete.");
        console.log("Final image URLs:");
        uploadedUrls.forEach((url, index) => {
            console.log(`${index + 1}. ${url}`);
        });
    }
    finally {
        rl.close();
    }
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Upload failed: ${message}`);
    process.exit(1);
});
