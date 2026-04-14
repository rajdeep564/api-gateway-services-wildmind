/// <reference types="node" />

import * as path from "path";
import * as readline from "readline";
import * as dotenv from "dotenv";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const ROOT_FOLDER_NAME = "newaryan";
const PLACEHOLDER_FILE = ".keep";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

type SimpleDirent = {
  name: string;
  isDirectory: () => boolean;
};

type QuestionReader = {
  question: (prompt: string, callback: (answer: string) => void) => void;
  close: () => void;
};

function sanitizeFolderName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/\s+/g, "-");
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function buildZataClient(): {
  client: S3Client;
  bucket: string;
  endpoint: string;
} {
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

  const client = new S3Client({
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

async function listExistingDirectoriesInZata(
  rootFolderName: string,
  bucket: string,
  endpoint: string,
): Promise<string[]> {
  const rootPath = path.resolve(process.cwd(), rootFolderName);
  try {
    const fs = await import("fs");
    const entries = fs.readdirSync(rootPath, { withFileTypes: true }) as SimpleDirent[];
    return entries
      .filter((entry: SimpleDirent) => entry.isDirectory())
      .map((entry: SimpleDirent) => entry.name);
  } catch {
    console.log(
      `No local cache found for ${rootFolderName}. Zata folders will be created under ${normalizeEndpoint(endpoint)}/${bucket}/${rootFolderName}/`
    );
    return [];
  }
}

async function createZataFolderPlaceholder(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: "",
      ContentType: "text/plain",
    })
  );
}

function askQuestion(rl: QuestionReader, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => resolve(answer));
  });
}

function isReadlineClosedError(error: unknown): boolean {
  return error instanceof Error && /readline was closed/i.test(error.message);
}

async function main(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  }) as QuestionReader;

  try {
    const { client: s3, bucket, endpoint } = buildZataClient();
    const rootPath = `${ROOT_FOLDER_NAME}/`;

    console.log(`Zata root folder ready: ${normalizeEndpoint(endpoint)}/${bucket}/${rootPath}`);

    const existingFolders = await listExistingDirectoriesInZata(ROOT_FOLDER_NAME, bucket, endpoint);
    if (existingFolders.length > 0) {
      console.log(`Existing folders inside ${ROOT_FOLDER_NAME}: ${existingFolders.join(", ")}`);
    } else {
      console.log(`No existing folders found inside ${ROOT_FOLDER_NAME}.`);
    }

    const modeAnswer = (await askQuestion(
      rl,
      "Choose mode: create new folder or use existing one? (new/existing): "
    ))
      .trim()
      .toLowerCase();

    let targetFolderName = "";

    if (modeAnswer === "existing") {
      if (existingFolders.length === 0) {
        console.log("No existing folders available, switching to new folder creation.");
      } else {
        const existingName = sanitizeFolderName(
          await askQuestion(rl, "Enter the existing folder name to use: ")
        );

        if (!existingName || !existingFolders.includes(existingName)) {
          throw new Error(`Folder "${existingName || "(empty)"}" was not found inside ${ROOT_FOLDER_NAME}.`);
        }

        targetFolderName = existingName;
      }
    }

    if (!targetFolderName) {
      const newFolderInput = sanitizeFolderName(
        await askQuestion(rl, "Enter the new folder name to create inside newaryan: ")
      );

      if (!newFolderInput) {
        throw new Error("A valid folder name is required.");
      }

      targetFolderName = newFolderInput;
    }

    const targetFolderPath = `${ROOT_FOLDER_NAME}/${targetFolderName}`;
    await createZataFolderPlaceholder(
      s3,
      bucket,
      `${targetFolderPath}/${PLACEHOLDER_FILE}`
    );

    const mediaChoice = (await askQuestion(
      rl,
      "What do you want inside it? image, video, or both? (image/video/both): "
    ))
      .trim()
      .toLowerCase();

    let foldersToCreate: string[] | null = null;
    if (mediaChoice === "both") {
      foldersToCreate = ["image", "video"];
    } else if (mediaChoice === "image" || mediaChoice === "video") {
      foldersToCreate = [mediaChoice];
    }

    if (!foldersToCreate) {
      throw new Error('Please choose one of these options: "image", "video", or "both".');
    }

    for (const folderName of foldersToCreate) {
      await createZataFolderPlaceholder(
        s3,
        bucket,
        `${targetFolderPath}/${folderName}/${PLACEHOLDER_FILE}`
      );
    }

    console.log("");
    console.log("Zata folder setup complete.");
    console.log(`Base folder: ${normalizeEndpoint(endpoint)}/${bucket}/${ROOT_FOLDER_NAME}/`);
    console.log(`Selected folder: ${normalizeEndpoint(endpoint)}/${bucket}/${targetFolderPath}/`);
    console.log(`Created/ensured media folders: ${foldersToCreate.join(", ")}`);
    console.log("You can now tell me which files to upload there.");
  } catch (error) {
    if (isReadlineClosedError(error)) {
      console.log("\nSetup cancelled.");
      return;
    }
    throw error;
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Setup failed: ${message}`);
  process.exit(1);
});
