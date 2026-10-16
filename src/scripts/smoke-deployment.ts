import { deploymentOrigin, smokeDeployment } from "../deployment/smoke.js";

try {
  const origin = deploymentOrigin(process.argv[2]);
  const passed = await smokeDeployment(origin);
  console.log(JSON.stringify({ event: "deployment.smoke_passed", checks: passed }));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Deployment check failed.");
  process.exitCode = 1;
}
