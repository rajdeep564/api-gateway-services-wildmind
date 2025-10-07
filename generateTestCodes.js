const admin = require('firebase-admin');
const path = require('path');

function getServiceAccountFromEnv() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try { return JSON.parse(json); } catch { /* ignore */ }
  }
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_B64;
  if (b64) {
    try {
      const decoded = Buffer.from(b64, 'base64').toString('utf8');
      return JSON.parse(decoded);
    } catch { /* ignore */ }
  }
  return null;
}

const svc = getServiceAccountFromEnv();
if (svc) {
  admin.initializeApp({ credential: admin.credential.cert(svc) });
} else {
  admin.initializeApp();
}

const db = admin.firestore();

// Function to generate a random redeem code
function generateRedeemCode(type) {
  const prefix = type === 'STUDENT' ? 'STU' : 'BUS';
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

// Function to create redeem code in Firestore
async function createRedeemCode(code, type, planCode, maxUses = 10) {
  const redeemCodeRef = db.collection('redeemCodes').doc(code);
  
  // Check if code already exists
  const existingCode = await redeemCodeRef.get();
  if (existingCode.exists) {
    throw new Error(`Redeem code ${code} already exists`);
  }

  const redeemCodeDoc = {
    code,
    type,
    planCode,
    status: 'ACTIVE',
    maxUses,
    currentUses: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    usedBy: []
  };

  await redeemCodeRef.set(redeemCodeDoc);
  console.log(`✅ Created ${type} code: ${code} (${planCode}) - Max uses: ${maxUses}`);
  return code;
}

// Main function to generate test codes
async function generateTestCodes() {
  try {
    console.log('🧪 Generating test redeem codes...\n');

    const codes = [];

    // Generate 1 Student test code (PLAN_A) - allows 10 uses for testing
    console.log('📚 Generating 1 Student test code (PLAN_A)...');
    const studentCode = generateRedeemCode('STUDENT');
    await createRedeemCode(studentCode, 'STUDENT', 'PLAN_A', 10);
    codes.push({ code: studentCode, type: 'STUDENT', planCode: 'PLAN_A', maxUses: 10 });

    // Generate 1 Business test code (PLAN_B) - allows 10 uses for testing
    console.log('💼 Generating 1 Business test code (PLAN_B)...');
    const businessCode = generateRedeemCode('BUSINESS');
    await createRedeemCode(businessCode, 'BUSINESS', 'PLAN_B', 10);
    codes.push({ code: businessCode, type: 'BUSINESS', planCode: 'PLAN_B', maxUses: 10 });

    console.log('\n🎉 Successfully generated test redeem codes!');
    console.log('\n📋 Test codes (can be used multiple times):');
    console.log(`📚 Student Code: ${studentCode}`);
    console.log(`💼 Business Code: ${businessCode}`);

    // Save codes to a file for easy access
    const fs = require('fs');
    const outputFile = path.join(__dirname, 'testRedeemCodes.json');
    fs.writeFileSync(outputFile, JSON.stringify(codes, null, 2));
    console.log(`\n💾 Test codes saved to: ${outputFile}`);

    console.log('\n✨ You can now use these codes in the signup flow for testing!');
    console.log('💡 These codes can be used up to 10 times each for testing purposes.');

  } catch (error) {
    console.error('❌ Error generating test codes:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
generateTestCodes();
