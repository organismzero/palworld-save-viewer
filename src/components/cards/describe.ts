/**
 * The plain-text twin of each hover card, for screen readers.
 *
 * The card itself is `aria-hidden`: it is a picture of the data, laid out for
 * the eye. This is what the trigger is `aria-describedby` while it is open.
 * The pal text is `palTooltip`, which was the native hover text before cards
 * and keeps its tests.
 */

import type { Refdata } from '../../refdata/refdata.ts'
import { element } from '../../lib/color.ts'
import { palTooltip } from '../../domain/palText.ts'
import { passiveText } from '../../views/breed/passiveText.ts'
import { itemText } from '../../domain/itemText.ts'
import { memberRole } from '../../lib/roles.ts'
import type { SaveIndex } from '../../domain/types.ts'
import type { CardDescriptor } from './hoverCard.ts'

export function describeCard(
  desc: CardDescriptor,
  data: Refdata | undefined,
  index: SaveIndex,
): string {
  switch (desc.kind) {
    case 'pal': {
      const d = desc.raw ? undefined : data
      const info = d?.species[desc.pal.characterId.toLowerCase()]
      const text = palTooltip(
        desc.pal,
        info,
        (a) => d?.passives[a.toLowerCase()],
      )
      return info?.partnerSkill
        ? `${text}\nPartner skill: ${info.partnerSkill}`
        : text
    }
    case 'species': {
      const info = data?.species[desc.id.toLowerCase()]
      const elements = [info?.element1, info?.element2]
        .map((e) => element(e)?.display)
        .filter(Boolean)
        .join(' / ')
      return join([
        desc.note,
        info?.name ?? desc.id,
        elements,
        info?.partnerSkill &&
          `Partner skill: ${info.partnerSkill}${info.partnerSkillText ? ` — ${info.partnerSkillText}` : ''}`,
      ])
    }
    case 'passive': {
      const text = passiveText(data)
      const id = desc.id.toLowerCase()
      return join([
        desc.note,
        text.name(id),
        text.description(id),
        text.origin(id),
      ])
    }
    case 'item': {
      const dynamic = desc.dynamicId
        ? index.dynamicItemById.get(desc.dynamicId)
        : undefined
      const info = data?.items[desc.staticId.toLowerCase()]
      return itemText({
        name: info?.name ?? desc.staticId,
        info,
        dynamic,
        count: desc.count,
        places: desc.places,
        passiveNames: dynamic?.passives.map(
          (a) => data?.passives[a.toLowerCase()]?.name ?? a,
        ),
      })
    }
    case 'player': {
      const player = index.playerByUid.get(desc.uid)
      const guild = index.guilds.find((g) =>
        g.members.some((m) => m.playerUid === desc.uid),
      )
      const member = guild?.members.find((m) => m.playerUid === desc.uid)
      const detail = index.playerDetails.find((d) => d.playerUid === desc.uid)
      const pals = index.palsByOwner.get(desc.uid)?.length ?? 0
      return join([
        desc.note,
        player?.name ?? member?.name ?? desc.uid,
        player ? `level ${player.level}` : 'no character in this world',
        guild && `${memberRole(guild, desc.uid).name} of ${guild.name}`,
        detail?.platform,
        player && `${pals} pals`,
      ])
    }
  }
}

function join(parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join('\n')
}
