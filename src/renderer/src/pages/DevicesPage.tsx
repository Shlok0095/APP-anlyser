import { useEffect, useState } from 'react'
import { PageHeader } from '../layouts/PageHeader'
import { getDesktopApi } from '../services/desktop-api'
import type { AdbDeviceInfo } from '@shared/contracts/ipc'

export function DevicesPage() {
  const [devices, setDevices] = useState<AdbDeviceInfo[]>([])
  const [packages, setPackages] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const api = getDesktopApi()
    if (!api) {
      setError('Desktop API unavailable.')
      return
    }
    void api
      .listDevices()
      .then(setDevices)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  const loadPackages = async (id: string): Promise<void> => {
    const api = getDesktopApi()
    if (!api) {
      return
    }
    setSelected(id)
    setPackages(await api.listDevicePackages(id))
  }

  return (
    <>
      <PageHeader
        title="Android Devices"
        description="Uses adb devices. Private app data is never read automatically."
      />
      {error ? <p className="muted">{error}</p> : null}
      {devices.length === 0 ? (
        <p className="muted">
          No ADB devices detected. Connect a device with USB debugging and authorize this computer.
        </p>
      ) : (
        <section className="card">
          {devices.map((device) => (
            <div className="kv-row" key={device.id}>
              <span>
                {device.id} · {device.status}
              </span>
              <button type="button" className="button" onClick={() => void loadPackages(device.id)}>
                List packages
              </button>
            </div>
          ))}
        </section>
      )}
      {selected ? (
        <section className="card">
          <h2>Packages on {selected}</h2>
          <ul>
            {packages.slice(0, 200).map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  )
}
