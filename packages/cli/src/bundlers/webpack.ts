// import { ChildProcess, spawn } from 'node:child_process';

// export const runWebpack = async (configPath: string): Promise<ChildProcess> => {
//   const webpack = await new Promise<ChildProcess>((resolve) => {
//     const webpackProcess = spawn(
//       'webpack',
//       [
//         'serve',
//         '--config',
//         configPath,
//         '--mode',
//         'development',
//         '--hot',
//         '--port',
//         '8081',
//       ],
//       {
//         stdio: 'ignore',
//         env: {
//           ...process.env,
//           RN_HARNESS: 'true',
//         },
//       }
//     );

//     resolve(webpackProcess);
//   });

//   await waitForWebpack(8081);
//   return webpack;
// };

// export const waitForWebpack = async (
//   port: number = 8081,
//   maxRetries: number = 10,
//   retryDelay: number = 2000
// ): Promise<void> => {
//   let attempts = 0;

//   while (attempts < maxRetries) {
//     attempts++;

//     try {
//       const response = await fetch(`http://localhost:${port}`);

//       if (response.ok) {
//         return;
//       }
//     } catch {}

//     if (attempts < maxRetries) {
//       await new Promise((resolve) => setTimeout(resolve, retryDelay));
//     }
//   }

//   throw new Error(`Metro bundler is not ready after ${maxRetries} attempts`);
// };
