const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require('./src/config/credentials/service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`
});

const db = admin.firestore();

// Function to generate a random redeem code
function generateRedeemCode(type) {
  const prefix = type === 'STUDENT' ? 'STU' : 'BUS';
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
}

// Function to create redeem code in Firestore
async function createRedeemCode(code, type, planCode, maxUses = 1) {
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
  console.log(`✅ Created ${type} code: ${code} (${planCode})`);
  return code;
}

// Main function to generate codes
async function generateCodes() {
  try {
    console.log('🚀 Starting redeem code generation...\n');

    const codes = [];

    // Generate 70 Student codes (PLAN_A)
    console.log('📚 Generating 70 Student codes (PLAN_A)...');
    for (let i = 0; i < 70; i++) {
      const code = generateRedeemCode('STUDENT');
      await createRedeemCode(code, 'STUDENT', 'PLAN_A', 1);
      codes.push({ code, type: 'STUDENT', planCode: 'PLAN_A' });
    }

    // Generate 50 Business codes (PLAN_B)
    console.log('\n💼 Generating 50 Business codes (PLAN_B)...');
    for (let i = 0; i < 50; i++) {
      const code = generateRedeemCode('BUSINESS');
      await createRedeemCode(code, 'BUSINESS', 'PLAN_B', 1);
      codes.push({ code, type: 'BUSINESS', planCode: 'PLAN_B' });
    }

    console.log('\n🎉 Successfully generated all redeem codes!');
    console.log(`📊 Total codes generated: ${codes.length}`);
    console.log(`📚 Student codes: ${codes.filter(c => c.type === 'STUDENT').length}`);
    console.log(`💼 Business codes: ${codes.filter(c => c.type === 'BUSINESS').length}`);

    // Save codes to a file for easy access
    const fs = require('fs');
    const outputFile = path.join(__dirname, 'generatedRedeemCodes.json');
    fs.writeFileSync(outputFile, JSON.stringify(codes, null, 2));
    console.log(`\n💾 Codes saved to: ${outputFile}`);

    // Display first few codes as examples
    console.log('\n📋 Sample codes:');
    console.log('Student codes:');
    codes.filter(c => c.type === 'STUDENT').slice(0, 5).forEach(c => console.log(`  ${c.code}`));
    console.log('\nBusiness codes:');
    codes.filter(c => c.type === 'BUSINESS').slice(0, 5).forEach(c => console.log(`  ${c.code}`));

    console.log('\n✨ You can now use these codes in the signup flow!');

  } catch (error) {
    console.error('❌ Error generating codes:', error);
  } finally {
    process.exit(0);
  }
}

// Run the script
generateCodes();
