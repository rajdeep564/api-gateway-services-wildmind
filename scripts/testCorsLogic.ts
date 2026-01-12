
import { URL } from 'url';

// Mock env
const env = {
  productionDomain: 'https://wildmindai.com',
  productionWwwDomain: 'https://www.wildmindai.com',
  productionStudioDomain: 'https://studio.wildmindai.com',
  frontendOrigins: ['https://www.wildmindai.com', 'https://wildmindai.com', 'https://studio.wildmindai.com'],
  allowedOrigins: ['https://wildmindai.com', 'https://www.wildmindai.com', 'http://localhost:3000', 'https://studio.wildmindai.com']
};

const allowedOrigins = [
  env.productionWwwDomain,
  env.productionDomain,
  env.productionStudioDomain,
  ...env.frontendOrigins,
  ...env.allowedOrigins
].filter(Boolean);

console.log('Allowed Origins:', allowedOrigins);

function checkOrigin(origin: string) {
  console.log(`\nChecking Origin: ${origin}`);
  
  if (allowedOrigins.includes(origin)) {
      console.log('✅ Direct Match');
      return;
  }

  try {
      const originUrl = new URL(origin);
      const prodDomain = env.productionDomain ? new URL(env.productionDomain).hostname : (env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname.replace(/^www\./, '') : undefined);
      const prodWwwDomain = env.productionWwwDomain ? new URL(env.productionWwwDomain).hostname : (prodDomain ? `www.${prodDomain}` : undefined);
      
      console.log(`Parsed prodDomain: ${prodDomain}`);
      console.log(`Parsed prodWwwDomain: ${prodWwwDomain}`);
      console.log(`Origin hostname: ${originUrl.hostname}`);

      if (prodDomain && (originUrl.hostname === prodWwwDomain ||
        originUrl.hostname === prodDomain ||
        originUrl.hostname.endsWith(`.${prodDomain}`))) {
        console.log('✅ Subdomain Match');
        return;
      }
  } catch (e) {
      console.log('❌ URL Parse Error:', e);
  }
  
  // Frontend origins check
  for (const frontendOrigin of env.frontendOrigins) {
      try {
        const allowHost = new URL(frontendOrigin).hostname;
        const originUrl = new URL(origin);
        const reqHost = originUrl.hostname;
        if (reqHost === allowHost || reqHost.endsWith(`.${allowHost}`)) {
          console.log(`✅ Frontend Origin Match (${allowHost})`);
          return;
        }
      } catch {
      }
  }

  console.log('❌ BLOCKED');
}

// Test cases
checkOrigin('https://wildmindai.com');
checkOrigin('https://www.wildmindai.com');
checkOrigin('https://studio.wildmindai.com');
checkOrigin('https://wildmind.ai'); // Should fail
