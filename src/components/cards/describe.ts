/**
 * The plain-text twin of each hover card, for screen readers.
 *
 * The card itself is `aria-hidden`: it is a picture of the data, laid out for
 * the eye. This is what the trigger is `aria-describedby` while it is open.
 * The pal text is `palTooltip`, which was the native hover text before cards
 * and keeps its tests.
 */

import type { Refdata } from '../../refdata/refdata.ts'
import { WORK_TYPES, element } from '../../lib/color.ts'
import { BEATS } from '../../domain/typeChart.ts'
import { palTooltip } from '../../domain/palText.ts'
import { passiveText } from '../../views/breed/passiveText.ts'
import { itemText } from '../../domain/itemText.ts'
import { memberRole } from '../../lib/roles.ts'
import { baseLabel } from '../../domain/bases.ts'
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
    case 'skill': {
      const info = data?.skills[desc.id.toLowerCase()]
      return join([
        desc.note,
        info?.name ?? desc.id,
        info?.element &&
          `${element(info.element)?.display ?? info.element} skill`,
        info && `power ${info.power}, cooldown ${info.cooldown} seconds`,
        info?.description,
      ])
    }
    case 'element': {
      const el = element(desc.name)
      if (!el) return desc.name
      const names = (ids: string[]) =>
        ids.map((id) => element(id)?.display ?? id).join(', ') || 'nothing'
      const beatenBy = Object.entries(BEATS)
        .filter(([, t]) => t.includes(el.name))
        .map(([a]) => a)
      return join([
        `${el.display} element`,
        `Strong against ${names([...(BEATS[el.name] ?? [])])}`,
        `Weak to ${names(beatenBy)}`,
      ])
    }
    case 'work': {
      const display =
        data?.work.find((w) => w.id === desc.id)?.display ??
        WORK_TYPES.find((w) => w.id === desc.id)?.display ??
        desc.id
      return `${display} work suitability`
    }
    case 'base': {
      const ordinal = index.bases.findIndex((b) => b.baseId === desc.id)
      const base = index.bases[ordinal]
      if (!base) return 'Base'
      const structures = index.structuresByBase.get(base.baseId)?.length ?? 0
      return join([
        baseLabel(base, ordinal + 1, data?.landmarks),
        `${structures} structures`,
      ])
    }
    case 'structure': {
      const s = index.structureById.get(desc.id)
      if (!s) return 'Structure'
      const builder = s.buildPlayerUid
        ? index.playerByUid.get(s.buildPlayerUid)?.name
        : undefined
      return join([
        data?.structures[s.mapObjectId.toLowerCase()]?.name ?? s.mapObjectId,
        builder && `built by ${builder}`,
        s.locked && 'locked',
      ])
    }
    case 'text':
      return join([desc.title, desc.sub])
  }
}

function join(parts: (string | false | undefined)[]): string {
  return parts.filter(Boolean).join('\n')
}
