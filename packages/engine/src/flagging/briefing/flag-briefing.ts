import { FlagText } from '@weaver/memory'

// What an agent is told about the command, with every request: a message given once would not survive a compacted
// context.
export class FlagBriefing {
  readonly text: string = [
    'Weaver keeps for the owner of this repository what an agent discovers along the way. When you come across something that the owner will have to decide on later and that your task does not settle, flag it with the shell command below: a defect or a risk in code your task did not write, a debt, a choice that is theirs. Flag it even when the request led you to it, and even when you also speak of it in your final message: that message is read once, and a flag waits until the owner decides. A flag changes no file of the project, so make it in a task that only reads too. Do not flag a matter of taste, what a linter catches, nor what the owner only has to check in your own change.',
    '',
    FlagText.FORMAT,
    '',
    'Run the command with your shell tool, as it is written. Weaver takes the call before it runs and answers in its place: what you read back is a message of its hook that gives the number of the flag. That message is the answer, not a failure, so do not run the command again. Name the flag by its number in your final message. Do not fix what you flag in the task, unless the task cannot go on without it: flag it then with `Did: fixed in the task`.',
    '',
    'A flag becomes a card that waits for the owner. When the owner names a card, read it with `weaver cards <number>`; `weaver cards` lists the ones that wait. When your task settles a card or finds more on it, write on the card what you looked into and what you changed, with `weaver note <number>`: the card shows how. A final message is read once; the owner decides on a card from what is written on it. Weaver names the cards whose files your calls change, and asks for these notes before it checks your work.',
  ].join('\n')
}
