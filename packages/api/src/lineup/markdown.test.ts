import { describe, expect, it } from 'vitest'
import { splitMarkdownLineup } from './markdown.js'

const act = (name: string) => ({ name, time: null, live: false, note: null })

describe('splitMarkdownLineup', () => {
  it('moves a flyer-import lineup out of the description', () => {
    const text = "Berlin's current Goth/Wave/Post-Punk/EBM ritual with a Halloween special.\n\n**Lineup**\n- NecroPhil\n- Frank Booth"
    expect(splitMarkdownLineup(text)).toEqual({
      lineup: [{ name: null, acts: [act('NecroPhil'), act('Frank Booth')] }],
      description: "Berlin's current Goth/Wave/Post-Punk/EBM ritual with a Halloween special.",
    })
  })

  it('keeps Live and DJs apart as groups', () => {
    const text = 'Live concert followed by DJ sets.\n\n**Live**\n- Volcan\n- Dardo\n\n**DJs**\n- Paura Diamante'
    expect(splitMarkdownLineup(text)).toEqual({
      lineup: [
        { name: 'Live', acts: [act('Volcan'), act('Dardo')] },
        { name: 'DJs', acts: [act('Paura Diamante')] },
      ],
      description: 'Live concert followed by DJ sets.',
    })
  })

  it('takes a longer heading that starts like a lineup', () => {
    const text = 'Equinoxious live.\n\n**Dj Lineup after the show**\n- Mara Mortem'
    expect(splitMarkdownLineup(text)?.lineup).toEqual([{ name: 'Dj Lineup after the show', acts: [act('Mara Mortem')] }])
  })

  it('takes the floors that follow a lineup list, with plain headings too', () => {
    const text = [
      'Halloween party with multiple stages.',
      '',
      '**Lineup**',
      '- Coco Cobra',
      '- casadephunk',
      '',
      'BLACK (hosted by Jiãla)',
      '- Coco Cobra [Queerpool]',
      '- Hongor',
      '',
      'GREEN (hosted by casadephunk)',
      '- elliephunk',
    ].join('\n')
    expect(splitMarkdownLineup(text)).toEqual({
      lineup: [
        { name: null, acts: [act('Coco Cobra'), act('casadephunk')] },
        { name: 'BLACK (hosted by Jiãla)', acts: [act('Coco Cobra [Queerpool]'), act('Hongor')] },
        { name: 'GREEN (hosted by casadephunk)', acts: [act('elliephunk')] },
      ],
      description: 'Halloween party with multiple stages.',
    })
  })

  it('keeps text after the lineup in the description', () => {
    const text = 'Intro.\n\n**Lineup**\n- A\n\nDoors at 22:00.'
    expect(splitMarkdownLineup(text)).toEqual({ lineup: [{ name: null, acts: [act('A')] }], description: 'Intro.\n\nDoors at 22:00.' })
  })

  it('leaves a list that is not a lineup alone', () => {
    expect(splitMarkdownLineup('**Tickets**\n- Presale 10€\n- Door 15€')).toBeNull()
    expect(splitMarkdownLineup('Just text.')).toBeNull()
  })
})
