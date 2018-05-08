/*
 * Copyright (C) 2018 Garden Technologies, Inc. <info@garden.io>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

import { Command } from "./base"
import { EntryStyle } from "../logger/types"
import { PluginContext } from "../plugin-context"
import { LoginStatusMap } from "../types/plugin"

export class LoginCommand extends Command {
  name = "login"
  help = "Log into the Garden framework"

  async action(ctx: PluginContext): Promise<LoginStatusMap> {
    ctx.log.header({ emoji: "unlock", command: "Login" })
    ctx.log.info({ msg: "Logging in...", entryStyle: EntryStyle.activity })

    const result = await ctx.login()

    ctx.log.info("\nLogin success!")

    return result
  }
}