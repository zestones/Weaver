#!/usr/bin/env node
import { CommandLine } from '../commands/line/command-line.ts'
import { ConsoleOutput } from '../output/console-output.ts'

const argv = process.argv.slice(2)

process.exitCode = await new CommandLine(process.cwd(), new ConsoleOutput(argv.includes(CommandLine.NO_COLOR))).run(argv)
