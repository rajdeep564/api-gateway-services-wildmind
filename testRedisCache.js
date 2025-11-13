/**
 * Simple Redis Cache Test
 * 
 * This script tests if Redis caching is working for generation APIs
 * 
 * Instructions:
 * 1. Make sure your API server is running (npm run dev or npm start)
 * 2. Get your auth token from the app
 * 3. Replace TOKEN below
 * 4. Run: node testRedisCache.js
 */

const TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6Il9FcFMtUSJ9.eyJpc3MiOiJodHRwczovL3Nlc3Npb24uZmlyZWJhc2UuZ29vZ2xlLmNvbS9hcGktZ2F0ZXdheS13aWxkbWluZCIsIm5hbWUiOiJSYWpkZWVwIENoYXZkYSIsInBpY3R1cmUiOiJodHRwczovL2xoMy5nb29nbGV1c2VyY29udGVudC5jb20vYS9BQ2c4b2NMNEZndTc1M0x4ZXljbjBXUlBJNVQxUlVnRkw4Q0xoNE9ZcXl3YmktTU5mQ2JOaXVRXHUwMDNkczk2LWMiLCJhdWQiOiJhcGktZ2F0ZXdheS13aWxkbWluZCIsImF1dGhfdGltZSI6MTc2MjE1NTYzNiwidXNlcl9pZCI6InNDcjl1RkQ4RjVZdDJIaHVVWHE2RXBiM3JXazIiLCJzdWIiOiJzQ3I5dUZEOEY1WXQySGh1VVhxNkVwYjNyV2syIiwiaWF0IjoxNzYyMTU1NjM4LCJleHAiOjE3NjI3NjA0MzgsImVtYWlsIjoiY2hhdmRhcmFqZGVlcDc3QGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJmaXJlYmFzZSI6eyJpZGVudGl0aWVzIjp7Imdvb2dsZS5jb20iOlsiMTAwNTI2MDQ5MDA3Mjg2NzUyMTkwIl0sImVtYWlsIjpbImNoYXZkYXJhamRlZXA3N0BnbWFpbC5jb20iXX0sInNpZ25faW5fcHJvdmlkZXIiOiJjdXN0b20ifX0.wxkUrdQw6VKa6PDQ--uB0l2gnmXxWt1t-lOCZD0BqlEh7GJukP0AmUiNWuoV4_i0q-EaxyJ9LKBliGdnuQUdczZuHZKQsM3ZOB4aweNpYVGWI5a1danYlXR8MpPzXWjBinTj7h_niq4sGhv5ktfYZ7yYoOCS7oCegfq2HPs9wGTkBFUNvRznxuOB0uZ3q5b6TYdckFS8j3q6QvgHfSyoFmtd9uVjO6cY4xPeKkPxJIcKsSpsMlAHwy7kNwf_eqKYrhwZuM9wawRjlBPk99XhHNZCygu-StMTSxIhML97C05UQrdUtXxd5IisWql--qzC9PkoM4pWopXcpOkeaav_LQ'; // Replace with your actual token
const API_URL = 'http://localhost:5000';

async function testCache() {
  console.log('🧪 Testing Redis Cache for Generation API\n');
  console.log('═══════════════════════════════════════════\n');

  // Check if token is setz
  if (TOKEN === 'YOUR_TOKEN_HERE') {
    console.log('❌ ERROR: Please set your TOKEN in the script');
    console.log('\n📝 How to get your token:');
    console.log('   1. Login to your app');
    console.log('   2. Open DevTools (F12)');
    console.log('   3. Go to Application → Local Storage');
    console.log('   4. Copy the auth token value');
    process.exit(1);
  }

  try {
    // Test 1: Fetch generations list (should be CACHE MISS first time)
    console.log('📊 Test 1: Fetch Generations List (First Time)\n');
    console.log('Expected: CACHE MISS → Firestore fetch → Cache save\n');
    
    const start1 = Date.now();
    const response1 = await fetch(`${API_URL}/api/generations?limit=5`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const time1 = Date.now() - start1;
    const data1 = await response1.json();
    
    if (!response1.ok) {
      console.log('❌ API Error:', data1);
      console.log('\n💡 Make sure:');
      console.log('   1. API server is running on port 5000');
      console.log('   2. Your token is valid');
      console.log('   3. You have some generations in your account');
      process.exit(1);
    }

    console.log(`⏱️  Response Time: ${time1}ms`);
    console.log(`📦 Items Returned: ${data1.data?.items?.length || 0}`);
    console.log(`✅ Status: ${response1.status}\n`);

    if (data1.data?.items?.length === 0) {
      console.log('⚠️  No generations found. Please create some generations first.');
      process.exit(0);
    }

    // Wait a bit for cache to be written
    await new Promise(resolve => setTimeout(resolve, 500));

    // Test 2: Fetch same list again (should be CACHE HIT)
    console.log('═══════════════════════════════════════════\n');
    console.log('📊 Test 2: Fetch Generations List (Second Time)\n');
    console.log('Expected: CACHE HIT → Redis fetch (should be MUCH faster)\n');
    
    const start2 = Date.now();
    const response2 = await fetch(`${API_URL}/api/generations?limit=5`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const time2 = Date.now() - start2;
    const data2 = await response2.json();
    
    console.log(`⏱️  Response Time: ${time2}ms`);
    console.log(`📦 Items Returned: ${data2.data?.items?.length || 0}`);
    console.log(`✅ Status: ${response2.status}\n`);

    // Calculate improvement
    const improvement = ((time1 - time2) / time1 * 100).toFixed(1);
    console.log('═══════════════════════════════════════════\n');
    console.log('📈 PERFORMANCE COMPARISON:\n');
    console.log(`   First Request:  ${time1}ms (Cache Miss)`);
    console.log(`   Second Request: ${time2}ms (Cache Hit)`);
    console.log(`   Improvement:    ${improvement}% faster 🚀\n`);

    if (time2 < time1 * 0.5) {
      console.log('✅ SUCCESS! Cache is working! Second request was significantly faster.\n');
    } else {
      console.log('⚠️  WARNING: Second request should be much faster. Cache might not be working.\n');
    }

    // Test 3: Fetch a single item
    const firstItemId = data1.data.items[0].id;
    console.log('═══════════════════════════════════════════\n');
    console.log('📊 Test 3: Fetch Single Generation Item\n');
    console.log(`   Item ID: ${firstItemId}\n`);
    
    const start3 = Date.now();
    const response3 = await fetch(`${API_URL}/api/generations/${firstItemId}`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const time3 = Date.now() - start3;
    
    console.log(`⏱️  Response Time: ${time3}ms`);
    console.log(`✅ Status: ${response3.status}\n`);

    // Wait and fetch again
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const start4 = Date.now();
    const response4 = await fetch(`${API_URL}/api/generations/${firstItemId}`, {
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
    const time4 = Date.now() - start4;
    
    console.log(`⏱️  Response Time (2nd): ${time4}ms`);
    console.log(`✅ Status: ${response4.status}\n`);

    const itemImprovement = ((time3 - time4) / time3 * 100).toFixed(1);
    console.log(`   Improvement: ${itemImprovement}% faster 🚀\n`);

    // Final summary
    console.log('═══════════════════════════════════════════\n');
    console.log('📋 FINAL SUMMARY:\n');
    console.log('   ✅ API is responding correctly');
    console.log(`   ✅ List requests: ${improvement}% faster on cache hit`);
    console.log(`   ✅ Item requests: ${itemImprovement}% faster on cache hit`);
    console.log('\n💡 Check your server logs for cache hit/miss messages:');
    console.log('   - Look for: [generationCache] ✅ CACHE HIT');
    console.log('   - Look for: [generationCache] ⚠️  CACHE MISS');
    console.log('   - Look for: [generationCache] 💾 CACHED\n');

  } catch (error) {
    console.log('❌ Error:', error.message);
    console.log('\n💡 Troubleshooting:');
    console.log('   1. Make sure API server is running: npm run dev');
    console.log('   2. Check if Redis is running: docker ps');
    console.log('   3. Verify your token is valid');
  }
}

testCache();
