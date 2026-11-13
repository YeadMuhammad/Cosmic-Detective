// All story text lives here, like fixtures.ts. Edit the words without touching any component.
// {name} is replaced with the player's callsign at runtime.
// Only Chapter 1 is written so far. Add chapters 2-5 as new entries in STORIES.

export type StoryArt = 'archive' | 'roof' | 'pleiades' | 'logbook' | 'plates'

export interface StoryScene {
  /** present = Dr. Chowdhury in the archive. memory = the player's own memory, dark starry aesthetic. */
  mode: 'present' | 'memory'
  /** short label shown above the caption */
  place: string
  art: StoryArt
  text: string
  /** Emotional fragmented story beats revealed sentence-by-sentence */
  beats?: string[]
  /** optional tap/drag mini-interaction (never blocks progress) */
  interaction?: 'pleiades'
}

export interface StoryChapter {
  chapter: number
  title: string
  subtitle: string
  /** case opened when the story ends */
  firstCase: number
  cta: string
  scenes: StoryScene[]
}

export const STORIES: Record<number, StoryChapter> = {
  1: {
    chapter: 1,
    title: 'The Seven Lights',
    subtitle: 'Before your first case, Dr. Chowdhury reads back the memory that brought you here.',
    firstCase: 1,
    cta: 'Open Case 001',
    scenes: [
      {
        mode: 'present',
        place: 'The archive',
        art: 'archive',
        text: 'Welcome, {name}. I read your application three times. One paragraph stayed with me, so before I hand you your first case, let me read it back to you.',
        beats: [
          'Welcome, {name}.',
          'I read your application three times.',
          'One paragraph stayed with me.',
          'So before I hand you your first case, let me read it back to you.',
        ],
      },
      {
        mode: 'memory',
        place: 'Memory · the roof · age six',
        art: 'roof',
        text: 'You were six. The power had gone out, as it often did, and the roof was still warm from the day. Abbu knelt beside you and pointed at a small smudge of light.\n\n“How many do you see?”',
        beats: [
          'You were six.',
          'The power had gone out, as it often did...',
          '...and the roof was still warm from the day.',
          'Abbu knelt beside you and pointed at a small smudge of light.',
          '“How many do you see?”',
        ],
      },
      {
        mode: 'memory',
        place: 'Memory · the count',
        art: 'pleiades',
        interaction: 'pleiades',
        text: 'You counted slowly, one finger at a time. “Seven.” He smiled the way he did when you were almost right.\n\n“Some people see six. Some see nine. The eyes keep trying to settle it. So write down what you see, and check again tomorrow.”',
        beats: [
          'You counted slowly, one finger at a time.',
          '“Seven.”',
          'He smiled the way he did when you were almost right.',
          '“Some people see six. Some see nine. The eyes keep trying to settle it.”',
          '“So write down what you see, and check again tomorrow.”',
        ],
      },
      {
        mode: 'present',
        place: 'The archive',
        art: 'logbook',
        text: 'You wrote that you have been checking again ever since. That habit is the entire job: look carefully, write it down, doubt yourself, look again.',
        beats: [
          'You wrote that you have been checking again ever since.',
          'That habit is the entire job:',
          'Look carefully. Write it down. Doubt yourself. Look again.',
        ],
      },
      {
        mode: 'present',
        place: 'The archive',
        art: 'plates',
        text: 'That child on the roof is the reason you are here, {name}. Two plates of the same sky disagree about one point of light. Go and see what is really there. Your first case is open.',
        beats: [
          'That child on the roof is the reason you are here, {name}.',
          'Two plates of the same sky disagree about one point of light.',
          'Go and see what is really there. Your first case is open.',
        ],
      },
    ],
  },
}

/** First case of each chapter, where its story plays. */
export const FIRST_CASE: Record<number, number> = { 1: 1, 2: 11, 3: 21, 4: 31, 5: 41 }

/** Which chapter story (if any) should play before opening case n and has not been seen yet. */
export const storyBefore = (n: number, seen: number[]): number | null => {
  const ch = Object.entries(FIRST_CASE).find(([, c]) => c === n)?.[0]
  const chapter = ch ? Number(ch) : null
  return chapter && STORIES[chapter] && !seen.includes(chapter) ? chapter : null
}
