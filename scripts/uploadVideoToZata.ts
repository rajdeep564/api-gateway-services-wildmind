import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Load environment variables (assumes .env in repo root)
dotenv.config({ path: path.resolve(__dirname, "../.env") });

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function getContentTypeFromExtension(ext: string): string {
  const normalized = ext.toLowerCase();
  switch (normalized) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".mkv":
      return "video/x-matroska";
    case ".webm":
      return "video/webm";
    case ".avi":
      return "video/x-msvideo";
    case ".flv":
      return "video/x-flv";
    case ".mpeg":
    case ".mpg":
      return "video/mpeg";
    default:
      return "application/octet-stream";
  }
}

async function main() {
  const rawVideoPath = await prompt("Enter the path to your video file: ");
  const username = await prompt("Enter the username to associate with this upload: ");

  // Trim surrounding single/double quotes in case the user pastes a quoted path
  const videoPath = rawVideoPath.replace(/^['"]|['"]$/g, "");

  if (!videoPath) {
    console.error("Error: video path is required.");
    process.exit(1);
  }

  if (!username) {
    console.error("Error: username is required.");
    process.exit(1);
  }

  const resolvedPath = path.resolve(videoPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: file not found: ${resolvedPath}`);
    process.exit(1);
  }

  const fileStat = fs.statSync(resolvedPath);
  if (!fileStat.isFile()) {
    console.error(`Error: not a file: ${resolvedPath}`);
    process.exit(1);
  }

  const bucket = process.env.ZATA_BUCKET || "devstoragev1";
  const endpoint = process.env.ZATA_ENDPOINT;
  const region = process.env.ZATA_REGION || "us-east-1";
  const accessKeyId = process.env.ZATA_ACCESS_KEY_ID || "";
  const secretAccessKey = process.env.ZATA_SECRET_ACCESS_KEY || "";

  if (!endpoint) {
    console.error(
      "Error: ZATA_ENDPOINT is not set in your environment. Please set it in .env or your env vars.",
    );
    process.exit(1);
  }

  const s3 = new S3Client({
    endpoint,
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: process.env.ZATA_FORCE_PATH_STYLE === "true",
  });

  const filename = path.basename(resolvedPath);
  const key = `users/${username}/inputvideo/${filename}`;
  const contentType = getContentTypeFromExtension(path.extname(filename));

  const buffer = await fs.promises.readFile(resolvedPath);

  console.log(`Uploading to Zata bucket=${bucket} key=${key} ...`);

  try {
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    await s3.send(putCommand);

    const publicUrl = `${normalizeEndpoint(endpoint)}/${bucket}/${key}`;
    console.log("Upload complete!");
    console.log(`- S3 key: ${key}`);
    console.log(`- Public URL: ${publicUrl}`);
  } catch (error) {
    console.error("Upload failed:", error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
