
import axios from 'axios';

async function probe() {
    const userId = 'sCr9uFD8F5Yt2HhuUXq6Epb3rWk2';
    // Try both localhost and 127.0.0.1
    const urls = [
        `http://localhost:3001/credits/${userId}`,
        `http://127.0.0.1:3001/credits/${userId}`,
        `http://localhost:3001/users/test`,
        `http://127.0.0.1:3001/users/test`
    ];

    console.log('🔍 Probing Credit Service...');

    for (const url of urls) {
        console.log(`\n---------------------------------`);
        console.log(`Requesting: ${url}`);
        try {
            const res = await axios.get(url, { validateStatus: () => true }); // Don't throw
            console.log(`Status: ${res.status} ${res.statusText}`);
            console.log(`Headers:`, res.headers);
            console.log(`Body Type:`, typeof res.data);
            console.log(`Body:`, JSON.stringify(res.data, null, 2));
        } catch (error: any) {
            console.error(`ERROR:`, error.message);
            if (error.code === 'ECONNREFUSED') {
                console.error('Connection refused - Service is not running on this port?');
            }
        }
    }
}

probe();
