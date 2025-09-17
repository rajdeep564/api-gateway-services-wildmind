import app from './app/app';
<<<<<<< HEAD
import { logger } from './utils/logger';
=======
>>>>>>> 0865155ce1f1203295733682fae733abf57333b9

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
<<<<<<< HEAD
  logger.info({ port: PORT }, 'API Gateway running');
=======
  console.log(`API Gateway running on port ${PORT}`);
>>>>>>> 0865155ce1f1203295733682fae733abf57333b9
});
