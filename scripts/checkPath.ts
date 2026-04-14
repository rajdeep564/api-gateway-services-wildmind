import path from 'path';
import fs from 'fs';

const servicesDir = path.resolve(__dirname, '../src/services');
// Only if __dirname is 'scripts' (if run from scripts dir)
// Wait, if I run `npx ts-node scripts/checkPath.ts` from root, __dirname is `scripts`.
// But previewService is in `src/services`.
// When previewService.ts runs, __dirname is `src/services`.

// Let's emulate previewService logic
const emulatedDirName = path.resolve(__dirname, '../src/services'); // assuming we run from root/scripts? No, __dirname in a module is that module's dir. 
// If I am in scripts/checkPath.ts:
// __dirname is .../scripts
// I need to test the path used in previewService.ts

const fabricPathFromService = path.resolve(emulatedDirName, '../../../mix_editor/designer/node_modules/fabric/dist/fabric.min.js');

console.log('Emulated Service Dir:', emulatedDirName);
console.log('Fabric Path:', fabricPathFromService);
console.log('Exists:', fs.existsSync(fabricPathFromService));
