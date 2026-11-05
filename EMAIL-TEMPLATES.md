# Sign-in emails in other languages

Not live. Supabase has one template per project, set in its dashboard, so these need pasting
there by hand. **Test first on a throwaway address, because this hasn't been run yet.**

The app now saves the language in the account's metadata when an account is created
(`language` in `src/auth.ts`). Accounts created before this have none, so they get English.
The language is saved once: changing it later in Settings doesn't change the emails.

`.Data` is Supabase's name for that metadata in a template, and the `if` is ordinary Go template
syntax. Keep today's English where the template says so: it's in the dashboard, not in this repo.
`{{ .Token }}` and the link stay exactly as `SUPABASE-SYNC.md` says. Bito never says *cagada* here.

## Before pasting

1. Create an account with `?lang=ca` and check `raw_user_meta_data` has `"language": "ca"` in
   Supabase's Users table.
2. Paste the **Confirm signup** template only, and sign up with a new address.
3. Check the email is in Catalan, then sign up with no `?lang=` and check it's in English.
4. Check whether the subject line accepts the same `if`. Supabase's docs don't say clearly. If it doesn't,
   use a subject that works in all languages, such as `Bito Chess`.
5. Only then paste the other two.

## Shape of each template

```html
{{ if eq .Data.language "ca" }}
  ...Catalan below...
{{ else if eq .Data.language "es" }}
  ...Spanish below...
{{ else if eq .Data.language "sv" }}
  ...Swedish below...
{{ else }}
  ...today's English...
{{ end }}
```

`LINK` below stands for the template's own `href` from `SUPABASE-SYNC.md`.

## Confirm signup

```html
{{ if eq .Data.language "ca" }}
<h2>Confirma el teu compte de Bito Chess</h2>
<p>El teu codi: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escriu-lo a Bito Chess. Caduca d'aquí a una hora.</p>
<p>També pots <a href="LINK">confirmar el compte amb aquest enllaç</a>.</p>
<p>Si no has creat cap compte, pots ignorar aquest correu.</p>
{{ else if eq .Data.language "es" }}
<h2>Confirma tu cuenta de Bito Chess</h2>
<p>Tu código: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escríbelo en Bito Chess. Caduca dentro de una hora.</p>
<p>También puedes <a href="LINK">confirmar la cuenta con este enlace</a>.</p>
<p>Si no has creado ninguna cuenta, puedes ignorar este correo.</p>
{{ else if eq .Data.language "sv" }}
<h2>Bekräfta ditt Bito Chess-konto</h2>
<p>Din kod: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Skriv in den i Bito Chess. Den slutar gälla om en timme.</p>
<p>Du kan också <a href="LINK">bekräfta kontot med den här länken</a>.</p>
<p>Om du inte har skapat något konto kan du bortse från det här mejlet.</p>
{{ else }}
<!-- today's English -->
{{ end }}
```

Subject: *Confirma el teu compte* / *Confirma tu cuenta* / *Bekräfta ditt konto*.

## Magic Link

```html
{{ if eq .Data.language "ca" }}
<h2>Inicia sessió a Bito Chess</h2>
<p>El teu codi: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escriu-lo a Bito Chess. Caduca d'aquí a una hora.</p>
<p>També pots <a href="LINK">iniciar sessió amb aquest enllaç</a>.</p>
<p>Si no l'has demanat tu, pots ignorar aquest correu.</p>
{{ else if eq .Data.language "es" }}
<h2>Inicia sesión en Bito Chess</h2>
<p>Tu código: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escríbelo en Bito Chess. Caduca dentro de una hora.</p>
<p>También puedes <a href="LINK">iniciar sesión con este enlace</a>.</p>
<p>Si no lo has pedido tú, puedes ignorar este correo.</p>
{{ else if eq .Data.language "sv" }}
<h2>Logga in på Bito Chess</h2>
<p>Din kod: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Skriv in den i Bito Chess. Den slutar gälla om en timme.</p>
<p>Du kan också <a href="LINK">logga in med den här länken</a>.</p>
<p>Om du inte har bett om det här kan du bortse från mejlet.</p>
{{ else }}
<!-- today's English -->
{{ end }}
```

Subject: *Inicia sessió a Bito Chess* / *Inicia sesión en Bito Chess* / *Logga in på Bito Chess*.

## Reset password

```html
{{ if eq .Data.language "ca" }}
<h2>Canvia la contrasenya de Bito Chess</h2>
<p>El teu codi: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escriu-lo a Bito Chess. Caduca d'aquí a una hora.</p>
<p>També pots <a href="LINK">canviar-la amb aquest enllaç</a>.</p>
<p>Si no l'has demanat tu, pots ignorar aquest correu. La contrasenya no canviarà.</p>
{{ else if eq .Data.language "es" }}
<h2>Cambia tu contraseña de Bito Chess</h2>
<p>Tu código: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Escríbelo en Bito Chess. Caduca dentro de una hora.</p>
<p>También puedes <a href="LINK">cambiarla con este enlace</a>.</p>
<p>Si no lo has pedido tú, puedes ignorar este correo. Tu contraseña no cambiará.</p>
{{ else if eq .Data.language "sv" }}
<h2>Byt ditt lösenord på Bito Chess</h2>
<p>Din kod: <strong style="font-size:24px;letter-spacing:3px">{{ .Token }}</strong></p>
<p>Skriv in den i Bito Chess. Den slutar gälla om en timme.</p>
<p>Du kan också <a href="LINK">byta det med den här länken</a>.</p>
<p>Om du inte har bett om det här kan du bortse från mejlet. Lösenordet ändras inte.</p>
{{ else }}
<!-- today's English -->
{{ end }}
```

Subject: *Canvia la contrasenya* / *Cambia tu contraseña* / *Byt ditt lösenord*.
