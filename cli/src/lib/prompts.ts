import prompts, { Answers, PromptObject } from "prompts"
import { CeremonyInputData, Circuit } from "../../types/index.js"
import theme from "./theme.js"

/** Prompts questions */
const noEndDateCeremonyQuestions: Array<PromptObject> = [
  {
    type: "text",
    name: "title",
    message: theme.monoD(`Give the ceremony a title`),
    validate: (title: string) => title.length > 0 || theme.redD(`${theme.error} You must provide a valid title/name!`)
  },
  {
    type: "text",
    name: "description",
    message: theme.monoD(`Give the ceremony a description`),
    validate: (title: string) => title.length > 0 || theme.redD(`${theme.error} You must provide a valid description!`)
  },
  {
    type: "date",
    name: "startDate",
    message: theme.monoD(`When should the ceremony begin?`),
    validate: (d: any) =>
      d > Date.now() ? true : theme.redD(`${theme.error} You cannot start a ceremony in the past!`)
  }
]

const circuitQuestions: Array<PromptObject> = [
  {
    name: "name",
    type: "text",
    message: theme.monoD(`Give the circuit a name`),
    validate: (value) => (value.length ? true : theme.redD(`${theme.error} You must provide a valid name!`))
  },
  {
    name: "description",
    type: "text",
    message: theme.monoD(`Give the circuit a description`),
    validate: (value) => (value.length ? true : theme.redD(`${theme.error} You must provide a valid description`))
  },
  {
    name: "prefix",
    type: "text",
    message: theme.monoD(`What will be the prefix for  circuit files as \`.r1cs\` and \`.zkey\`?`),
    validate: (value) => (value.length ? true : theme.redD(`${theme.error} You must provide a valid prefix!`))
  },
  {
    name: "constraints",
    type: "number",
    message: theme.monoD(`Circuit constraints n°:`),
    validate: (value) =>
      value >= 1 && value <= 9999999999
        ? true
        : theme.redD(`${theme.error} You must provide a valid number of constraints!`)
  },
  {
    name: "powers",
    type: "number",
    message: theme.monoD(`PoT 2^`),
    validate: (value) =>
      value >= 1 && value <= 71 ? true : theme.redD(`${theme.error} You must provide a valid number for PoT!`)
  },
  {
    name: "avgContributionTime",
    type: "number",
    message: theme.monoD(`Est. time x contribution (seconds):`),
    validate: (value) =>
      value >= 1 && value <= 9999999999
        ? true
        : theme.redD(`${theme.error} You must provide a valid number for contribution time estimation!`)
  }
]

/**
 * Show a binary question with custom options for confirmation purposes.
 * @param question <string> - the question to be answered.
 * @param active <string> - the active option (= yes).
 * @param inactive <string> - the inactive option (= no).
 * @returns <Promise<Answers<string>>>
 */
export const askForConfirmation = async (
  question: string,
  active: string,
  inactive: string
): Promise<Answers<string>> =>
  prompts({
    type: "toggle",
    name: "confirmation",
    message: theme.monoD(question),
    initial: false,
    active,
    inactive
  })

/**
 * Show a series of questions about the ceremony.
 * @returns <Promise<CeremonyInputData>> - the necessary information for the ceremony entered by the coordinator.
 */
export const askCeremonyData = async (): Promise<CeremonyInputData> => {
  // Prompt for ceremony data.
  const { title, description, startDate } = await prompts(noEndDateCeremonyQuestions)

  if (!title || !description || !startDate) throw new Error(`Please, enter any information you are asked for.`)

  const { endDate } = await prompts({
    type: "date",
    name: "endDate",
    message: theme.monoD(`And when close?`),
    validate: (d) =>
      d > Date.now()
        ? true && d > startDate
        : theme.redD(`${theme.error} You cannot close a ceremony before the opening!`)
  })

  if (!endDate) throw new Error(`Please, enter any information you are asked for.`)

  return {
    title,
    description,
    startDate,
    endDate
  }
}

/**
 * Show a series of questions about the circuits.
 * @returns Promise<Array<Circuit>> - the necessary information for the circuits entered by the coordinator.
 */
export const askCircuitsData = async (): Promise<Array<Circuit>> => {
  const circuits: Array<Circuit> = []
  let wannaAddAnotherCircuit = true
  let seqPos = 1

  // Prompt as long as there are circuits to be added.
  while (wannaAddAnotherCircuit) {
    console.log(theme.monoD(theme.bold(`\nCircuit # ${theme.yellowD(`${seqPos}`)}\n`)))

    // Prompt for circuit data.
    const { name, description, prefix, constraints, powers, avgContributionTime } = await prompts(circuitQuestions)

    if (!name || !description || !prefix || !constraints || !powers || !avgContributionTime)
      throw new Error(`Please, enter any information you are asked for.`)

    const { confirmation } = await askForConfirmation("Do you want to add more circuits for the ceremony?", "Yes", "No")

    circuits.push({
      name,
      description,
      prefix,
      constraints,
      powers,
      avgContributionTime,
      sequencePosition: seqPos
    })

    seqPos += 1
    wannaAddAnotherCircuit = confirmation
  }

  if (!circuits.length) throw new Error(`Please, enter any information you are asked for.`)

  return circuits
}
