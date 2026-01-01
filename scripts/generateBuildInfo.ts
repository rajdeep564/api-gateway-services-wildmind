
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const BUILD_INFO_PATH = path.join(__dirname, '../src/config/buildInfo.json');

async function generateBuildInfo() {
  console.log('[BuildInfo] Generating build info...');

  let commitHash = 'unknown';
  try {
    commitHash = execSync('git rev-parse HEAD').toString().trim();
  } catch (error) {
    console.warn('[BuildInfo] Failed to get git commit hash, usage "unknown"', error);
  }

  const buildInfo = {
    commitHash,
    buildTime: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || 'development'
  };

  try {
    // Write to src (for dev)
    const srcDir = path.dirname(BUILD_INFO_PATH);
    if (!fs.existsSync(srcDir)) {
      fs.mkdirSync(srcDir, { recursive: true });
    }
    fs.writeFileSync(BUILD_INFO_PATH, JSON.stringify(buildInfo, null, 2));
    
    // Write to dist (for prod)
    const distPath = path.join(__dirname, '../dist/config/buildInfo.json');
    const distDir = path.dirname(distPath);
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }
    fs.writeFileSync(distPath, JSON.stringify(buildInfo, null, 2));

    console.log('[BuildInfo] Info generated successfully in src and dist:', buildInfo);
  } catch (error) {
    console.error('[BuildInfo] Failed to write build info file:', error);
    process.exit(1);
  }
}

generateBuildInfo();
