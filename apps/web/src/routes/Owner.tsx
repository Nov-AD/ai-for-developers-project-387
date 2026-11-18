import { useState, type FormEvent } from 'react'
import {
  createMeetingTypeMutation,
  listMeetingTypesQueryKey,
  zValidationError,
  type ValidationError
} from '@calendar/sdk'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MeetingTypes } from '@/components/MeetingTypes'
import { UpcomingBookings } from '@/components/UpcomingBookings'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function Owner() {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState('')
  const [errors, setErrors] = useState<ValidationError['fieldErrors']>({})
  const queryClient = useQueryClient()
  const create = useMutation({
    ...createMeetingTypeMutation(),
    retry: false,
    onSuccess: async () => {
      setName('')
      setDescription('')
      setDuration('')
      setErrors({})
      await queryClient.invalidateQueries({ queryKey: listMeetingTypesQueryKey() })
    }
  })
  const serverError = zValidationError.safeParse(create.error)
  const fieldErrors = { ...(serverError.success ? serverError.data.fieldErrors : {}), ...errors }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (create.isPending) return
    create.reset()
    const nextErrors: ValidationError['fieldErrors'] = {}
    const nameLength = Array.from(name.trim()).length
    if (nameLength < 1 || nameLength > 100) {
      nextErrors.name = [
        'Название после удаления крайних пробелов должно содержать от 1 до 100 символов.'
      ]
    }
    if (Array.from(description).length > 2000) {
      nextErrors.description = ['Описание должно содержать не более 2000 символов.']
    }
    const durationMinutes = Number(duration)
    if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 540) {
      nextErrors.durationMinutes = ['Длительность — целое число от 1 до 540 минут.']
    }
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return
    create.mutate({ body: { name, description, durationMinutes } })
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-8 px-6 py-16 sm:py-24">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Управление календарём</h1>
      <aside
        aria-label="Ограничения учебного приложения"
        className="rounded-xl border bg-secondary p-4 text-sm"
      >
        <p>
          Данные публичны и сбрасываются при перезапуске. Не вводите реальные персональные данные.
        </p>
        <details className="mt-2">
          <summary className="w-fit cursor-pointer rounded-sm py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">
            Подробнее об ограничениях
          </summary>
          <div className="mt-2 space-y-2">
            <p>
              Раздел не защищён авторизацией. Данные доступны каждому, кто обращается к приложению.
            </p>
            <p>
              Данные хранятся в памяти: типы встреч и записи исчезают после перезапуска. Работа в
              нескольких процессах не поддерживается.
            </p>
          </div>
        </details>
      </aside>
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">Новый тип встречи</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate aria-label="Создание типа встречи">
            {(create.isError || Object.keys(fieldErrors).length > 0) && (
              <div role="alert" className="mb-4 space-y-2">
                <p>
                  {create.isError
                    ? serverError.success
                      ? `Не удалось сохранить тип встречи. ${serverError.data.message}`
                      : 'Ответ не получен: тип встречи мог сохраниться. Проверьте соединение и список перед повторной попыткой.'
                    : 'Проверьте поля формы.'}
                </p>
                <ul className="list-inside list-disc">
                  {Object.entries(fieldErrors).map(([field, messages]) => (
                    <li key={field} id={`${field}-error`}>
                      {messages.join(' ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <fieldset disabled={create.isPending} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="type-name" className="block text-sm font-medium">
                  Название
                </label>
                <input
                  id="type-name"
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                  className="w-full rounded-md border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="type-description" className="block text-sm font-medium">
                  Описание (необязательно)
                </label>
                <textarea
                  id="type-description"
                  name="description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  aria-invalid={Boolean(fieldErrors.description)}
                  aria-describedby={fieldErrors.description ? 'description-error' : undefined}
                  className="w-full rounded-md border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="type-duration" className="block text-sm font-medium">
                  Длительность в минутах
                </label>
                <input
                  id="type-duration"
                  name="durationMinutes"
                  type="number"
                  min={1}
                  max={540}
                  step={1}
                  required
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.durationMinutes)}
                  aria-describedby={
                    fieldErrors.durationMinutes ? 'durationMinutes-error' : undefined
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-ring"
                />
              </div>
              <Button type="submit" disabled={create.isPending}>
                Создать тип встречи
              </Button>
            </fieldset>
          </form>
          {create.isPending && (
            <p role="status" className="mt-4">
              Сохраняем тип встречи…
            </p>
          )}
          {create.isSuccess && (
            <p role="status" className="mt-4">
              Тип встречи «{create.data.name}» создан.
            </p>
          )}
        </CardContent>
      </Card>
      <section aria-labelledby="meeting-types-heading">
        <h2 id="meeting-types-heading" className="text-xl font-semibold">
          Типы встреч
        </h2>
        <MeetingTypes />
      </section>
      <section aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading" className="text-xl font-semibold">
          Предстоящие записи
        </h2>
        <UpcomingBookings />
      </section>
    </div>
  )
}
