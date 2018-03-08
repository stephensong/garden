import { Service, ServiceStatus } from "../../types/service"
import { join, relative, resolve } from "path"
import * as Joi from "joi"
import * as escapeStringRegexp from "escape-string-regexp"
import { DeploymentError } from "../../exceptions"
import {
  gcfServicesSchema, GoogleCloudFunctionsModule,
} from "../google/google-cloud-functions"
import {
  ConfigureEnvironmentParams,
  DeployServiceParams, GetEnvironmentStatusParams, GetServiceLogsParams, GetServiceOutputsParams,
  GetServiceStatusParams, ParseModuleParams,
  Plugin,
} from "../../types/plugin"
import { GardenContext } from "../../context"
import { STATIC_DIR } from "../../constants"

const emulatorModulePath = join(STATIC_DIR, "local-gcf-container")
const emulatorPort = 8010
const emulatorServiceName = "google-cloud-functions"

export class LocalGoogleCloudFunctionsProvider implements Plugin<GoogleCloudFunctionsModule> {
  name = "local-google-cloud-functions"
  supportedModuleTypes = ["google-cloud-function"]

  parseModule({ ctx, config }: ParseModuleParams<GoogleCloudFunctionsModule>) {
    const module = new GoogleCloudFunctionsModule(ctx, config)

    // TODO: check that each function exists at the specified path

    module.services = Joi.attempt(config.services, gcfServicesSchema)

    return module
  }

  async getEnvironmentStatus({ ctx }: GetEnvironmentStatusParams) {
    // Check if functions emulator container is running
    const status = await ctx.getServiceStatus(await this.getEmulatorService(ctx))

    return { configured: status.state === "ready" }
  }

  async configureEnvironment({ ctx, env }: ConfigureEnvironmentParams) {
    const status = await this.getEnvironmentStatus({ ctx, env })

    // TODO: This check should happen ahead of calling this handler
    if (status.configured) {
      return
    }

    const service = await this.getEmulatorService(ctx)

    // We mount the project root into the container, so we can exec deploy any function in there later.
    service.config.volumes = [{
      name: "functions",
      containerPath: "/functions",
      hostPath: ctx.projectRoot,
    }]

    // TODO: Publish this container separately from the project instead of building it here
    await ctx.buildModule(service.module)
    await ctx.deployService(service)
  }

  async getServiceStatus({ ctx, service }: GetServiceStatusParams<GoogleCloudFunctionsModule>): Promise<ServiceStatus> {
    const emulator = await this.getEmulatorService(ctx)
    const result = await ctx.execInService(emulator, ["functions-emulator", "list"])

    // Regex fun. Yay.
    // TODO: Submit issue/PR to @google-cloud/functions-emulator to get machine-readable output
    if (result.output.match(new RegExp(`READY\\s+│\\s+${escapeStringRegexp(service.name)}\\s+│`, "g"))) {
      // For now we don't have a way to track which version is developed.
      // We most likely need to keep track of that on our side.
      return { state: "ready" }
    } else {
      return {}
    }
  }

  async deployService({ ctx, service, env }: DeployServiceParams<GoogleCloudFunctionsModule>) {
    const containerFunctionPath = resolve(
      "/functions",
      relative(ctx.projectRoot, service.module.path),
      service.config.path,
    )

    const emulator = await this.getEmulatorService(ctx)
    const result = await ctx.execInService(
      emulator,
      [
        "functions-emulator", "deploy",
        "--trigger-http",
        "--project", "local",
        "--region", "local",
        "--local-path", containerFunctionPath,
        "--entry-point", service.config.entrypoint || service.name,
        service.config.function,
      ],
    )

    if (result.code !== 0) {
      throw new DeploymentError(`Deploying function ${service.name} failed: ${result.output}`, {
        serviceName: service.name,
        error: result.stderr,
      })
    }

    return this.getServiceStatus({ ctx, service, env })
  }

  async getServiceOutputs({ ctx, service }: GetServiceOutputsParams<GoogleCloudFunctionsModule>) {
    const emulator = await this.getEmulatorService(ctx)

    return {
      endpoint: `http://${emulator.name}:${emulatorPort}/local/local/${service.config.function}`,
    }
  }

  async getServiceLogs({ ctx, env, stream, tail }: GetServiceLogsParams) {
    const emulator = await this.getEmulatorService(ctx)
    const handler = ctx.getActionHandler("getServiceLogs", "container")
    // TODO: filter to only relevant function logs
    return handler({ ctx, service: emulator, env, stream, tail })
  }

  private async getEmulatorService(ctx: GardenContext) {
    const module = await ctx.resolveModule(emulatorModulePath)

    return new Service(module, emulatorServiceName)
  }
}