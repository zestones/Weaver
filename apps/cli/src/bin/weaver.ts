#!/usr/bin/env node
import { CommandLine } from '../commands/line/command-line.ts'
import { ConsoleOutput } from '../output/console-output.ts'

process.exitCode = new CommandLine(process.cwd(), new ConsoleOutput()).run(process.argv.slice(2))
