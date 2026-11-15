// Match on visible contents: Android often reposts the same notice with a new timestamp.
export function createNotificationTracker() {
  const snapshots = new Map()
  const histories = new Map()
  return (identity, notices, posted) => {
    const previous = snapshots.get(identity)
    const fingerprint = notice => JSON.stringify([notice.title || '', notice.text || ''])
    const current = new Map(notices.map(notice => [notice.key, fingerprint(notice)]))
    snapshots.delete(identity)
    snapshots.set(identity, current)
    if (snapshots.size > 32)
      snapshots.delete(snapshots.keys().next().value)
    const history = histories.get(identity) || new Set()
    histories.set(identity, history)
    const changed = []
    for (const notice of posted ? [posted] : notices) {
      const event = JSON.stringify([notice.key, fingerprint(notice), notice.postTime ?? notice.time ?? 0])
      const isNew = posted || (previous && previous.get(notice.key) !== fingerprint(notice))
      if (isNew && !notice.ongoing && !history.has(event))
        changed.push(notice)
      history.add(event)
      if (history.size > 1024)
        history.delete(history.values().next().value)
    }
    if (histories.size > 32)
      histories.delete(histories.keys().next().value)
    return changed
  }
}
