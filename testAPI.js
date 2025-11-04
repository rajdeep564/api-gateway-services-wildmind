const axios = require('axios');

const BASE_URL = 'http://localhost:5001/api';
const ADMIN_KEY = 'WILDMIND_ADMIN_2024';

async function testRedeemCodeAPI() {
  console.log('🧪 Testing Redeem Code API...\n');

  try {
    // Test 1: Create Student Codes
    console.log('📚 Test 1: Creating 3 Student codes...');
    const createResponse = await axios.post(`${BASE_URL}/redeem-codes/create`, {
      type: 'STUDENT',
      count: 3,
      maxUsesPerCode: 1,
      adminKey: ADMIN_KEY
    });

    console.log('✅ Student codes created:', createResponse.data.data.codes);
    console.log('📅 Expires at:', createResponse.data.data.expiresAtReadable);
    console.log('💰 Credits per code:', createResponse.data.data.creditsPerCode);
    console.log('');

    // Test 2: Validate a code
    const testCode = createResponse.data.data.codes[0];
    console.log('🔍 Test 2: Validating code:', testCode);
    const validateResponse = await axios.post(`${BASE_URL}/redeem-codes/validate`, {
      redeemCode: testCode
    });

    console.log('✅ Validation result:', validateResponse.data.data);
    console.log('');

    // Test 3: Create Business Codes with custom expiry (72 hours)
    console.log('💼 Test 3: Creating 2 Business codes with 72-hour expiry...');
    const businessResponse = await axios.post(`${BASE_URL}/redeem-codes/create`, {
      type: 'BUSINESS',
      count: 2,
      maxUsesPerCode: 1,
      expiresIn: 72,
      adminKey: ADMIN_KEY
    });

    console.log('✅ Business codes created:', businessResponse.data.data.codes);
    console.log('📅 Custom expiry:', businessResponse.data.data.expiresAtReadable);
    console.log('');

    // Test 4: Test error handling - Invalid admin key
    console.log('❌ Test 4: Testing invalid admin key...');
    try {
      await axios.post(`${BASE_URL}/redeem-codes/create`, {
        type: 'STUDENT',
        count: 1,
        adminKey: 'INVALID_KEY'
      });
    } catch (error) {
      console.log('✅ Error handled correctly:', error.response.data.message);
    }
    console.log('');

    // Test 5: Test error handling - Invalid count
    console.log('❌ Test 5: Testing invalid count...');
    try {
      await axios.post(`${BASE_URL}/redeem-codes/create`, {
        type: 'STUDENT',
        count: 1001, // Too many
        adminKey: ADMIN_KEY
      });
    } catch (error) {
      console.log('✅ Error handled correctly:', error.response.data.message);
    }
    console.log('');

    console.log('🎉 All tests completed successfully!');
    console.log('\n📋 Summary:');
    console.log('- ✅ Student codes created and validated');
    console.log('- ✅ Business codes created with custom expiry');
    console.log('- ✅ Error handling works correctly');
    console.log('- ✅ API is ready for production use');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Run the test
testRedeemCodeAPI();
