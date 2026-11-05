# Bito Chess glossary

Marçal edits translations himself in `npm run copy`, so they may differ from the English on purpose.

Read this before every translation pass. It keeps the words the same across the app, so a
correction here fixes every case and every later pass.

Catalan's voice comes from `catalan-instructions-bito.md` (Marçal, 2026-11-04). Where the
two disagree, this file wins, because it records the decisions made after that guide.

**Status:** approved by Marçal, 2026-11-04. Swedish still needs a Swedish player to read it.

## Rules for all three languages

- Say *tu* / *tú* / *du*, never the formal form.
- Avoid wording that assumes the player's gender: *Et donem la benvinguda*, *Te damos la
  bienvenida*. A guest is someone "without an account", never *convidat* or *invitado*.
- Short, direct sentences. Imperatives for instructions. Few exclamation marks.
- Show facts, and don't explain the obvious.
- If a sentence sounds translated, rewrite it from scratch.
- Check three things: is it the right chess word, would a speaker say it, is it the shortest
  clear way.
- Moves: write them in English letters in the translation files (*Nf3*). The app shows piece symbols, or
  the language's own letters if someone picks letters: *Cf3* in Catalan and Spanish, *Sf3* in Swedish. A
  translation written with *Cf3* would fail the move check, and could be taken for the wrong piece.
- Opening names from the library aren't translated yet (Phase 10). Names we wrote ourselves, for
  starter pack lines and traps, are translated: see below.
- "Bito" and "Bito Chess" are never translated.

**Piece letters:** *R D T A C* in Catalan and Spanish, *K D T L S* in Swedish.

**Catalan only:** *badada* and *cagada* are Bito's one playful touch. Spanish and Swedish stay
neutral. *Cagada* is used inside the app only: never in the landing page, legal text, app store
text or emails.

**Legal pages:** *errors* in Catalan, never *badades*. Same first person as the English.

**Spanish:** keep its own list of calques from English, as Catalan's guide does. A past game is told in the past
too: *Jugaste {move}*.

**Swedish:** use fewer exclamation marks than Catalan, and watch long compound words on buttons.

## Decided

| English | Catalan | Spanish | Swedish |
|---|---|---|---|
| chess | escacs | ajedrez | schack |
| game | partida | partida | parti |
| opening | obertura | apertura | öppning |
| repertoire | repertori | repertorio | repertoar |
| variation | variant | variante | variant |
| line | línia | línea | linje |
| position | posició | posición | ställning |
| move | jugada | jugada | drag |
| best move | millor jugada | mejor jugada | bästa drag |
| brilliant move | jugada brillant | jugada brillante | briljant drag |
| training | entrenament | entrenamiento | träning |
| exercise | exercici | ejercicio | övning |
| puzzle | problema, problemes | problema, problemas | problem |
| review (noun) | repàs | repaso | repetition |
| spaced repetition | repetició espaiada | repetición espaciada | spridd repetition |
| streak | ratxa | racha | svit |
| accuracy | precisió | precisión | precision |
| check | escac | jaque | schack |
| checkmate | escac i mat | jaque mate | schackmatt |
| draw | taules | tablas | remi |
| win | victòria | victoria | vinst |
| loss | derrota | derrota | förlust |
| time pressure | pressió de temps | presión de tiempo | tidsnöd |
| due | pendent | pendiente | att repetera |
| Full Access | Accés complet | Acceso completo | Full tillgång |

Pieces: *peó, cavall, alfil, torre, dama, rei* / *peón, caballo, alfil, torre, dama, rey* /
*bonde, springare, löpare, torn, dam, kung*.

### Move types

| English | Catalan | Spanish | Swedish |
| --- | --- | --- | --- |
| Brilliant | Brillant | Brillante | Briljant |
| Great | Brutal | Muy buena | Mycket bra |
| Best | Millor | Mejor | Bästa |
| Excellent | Excel·lent | Excelente | Utmärkt |
| Good | Bona | Buena | Bra |
| Book | Llibre | Libro | Textbok |
| Inaccuracy | Imprecisió | Imprecisión | Ogenomtänkt |
| Mistake | Badada | Error | Misstag |
| Blunder | Cagada | Error grave | Blunder |
| Missed win | Victòria perduda | Victoria desaprovechada | Missad vinst |

**"Mistakes" in general,** meaning the list of things to fix, which holds both kinds:
*cagades* in Catalan, so "Mistakes to fix" is *Cagades per corregir*. *Badada* is the evaluation
of one move, and the softer word for a stranger's first screen: *les obertures que jugues i les
badades que fas*. Spanish uses *errores*, Swedish *misstag*.

**A move from a past game** is told in the past: *Vas jugar {move} i vas deixar escapar el rival*,
never *Aquí has fet*.

### Words that stay one way (Catalan)

| Use | Not |
|---|---|
| desar | guardar, except where the guide's agreed sentences say *es guarden* |
| iniciar sessió | accedir al compte |
| jugada | moviment |
| partida | joc |
| variant | variació |
| repàs | revisió |
| problema | trencaclosques |
| Alguna cosa ha fallat | S'ha produït un error |
| fer una jugada | realitzar, efectuar, jugar un moviment |
| escriu | introdueix |
| tria | selecciona |

### Agreed sentences (Catalan)

| English | Catalan |
|---|---|
| Improve your next move | Millora la teva pròxima jugada |
| Play your first move | Juga la teva primera jugada |
| Show the move | Mostra la jugada |
| Next position | Posició següent |
| Keep going | Continua! |
| Nothing due right now | Ara mateix no tens res pendent |
| Lines to remember | Línies per recordar |
| Mistakes to fix | Cagades per corregir |
| Your most forgotten moves | Les jugades que més oblides |
| Relearn forgotten lines | Torna a aprendre les línies oblidades |
| 3 lines due | 3 línies pendents |
| Not that one — try again | Incorrecte. Torna-hi. |
| It's in training. It'll come back tomorrow, before you forget it. | Ja ho estàs entrenant. Demà tornarà a aparèixer, abans que l'oblidis. |
| Your lines and progress follow you to any phone you sign in on. | Les teves línies i el teu progrés es guarden a qualsevol telèfon on iniciïs sessió. |
| Free, no signup. Your games stay on your device. | Gratuït i sense registre. Les teves partides es queden al teu dispositiu. |
| We'll read your games and show you the openings you actually play. | Analitzem les teves partides i et mostrem les obertures que realment jugues. |
| Something went wrong. Try again in a moment. | Alguna cosa ha fallat. Torna-ho a provar d'aquí a una estona. |

Buttons, encouragement, corrections, empty states and calques to avoid are in the guide,
sections 5 to 9.

## Screens and features

| English in the app | Catalan | Spanish | Swedish |
| --- | --- | --- | --- |
| Home | Inici | Inicio | Hem |
| Train | Entrena | Entrenar | Träna |
| Openings | Obertures | Aperturas | Öppningar |
| My games | Partides | Partidas | Partier |
| Statistics | Estadístiques | Estadísticas | Statistik |
| Middlegame | Mig joc | Medio juego | Mittspel |
| Tactics | Tàctica | Táctica | Taktik |
| Endgames | Finals | Finales | Slutspel |
| Daily challenge | Repte diari | Reto diario | Dagens utmaning |
| Get started | Primers passos | Primeros pasos | Kom igång |
| Starter packs | Kits d'inici | Paquetes de inicio | Startpaket |
| Mastered | Dominada | Dominada | Inlärd |
| New move | Jugada nova | Jugada nueva | Nytt drag |
| Drill (a line) | Entrena | Entrena | Träna |
| Run your book | Repassa el repertori | Repasa tu repertorio | Repetera repertoaren |
| Whole lines | Línies senceres | Líneas completas | Hela linjer |
| Missed moves | Jugades fallades | Jugadas falladas | Missade drag |
| Weak spots | Punts febles | Puntos débiles | Svaga punkter |
| Time attack | Contrarellotge | Contrarreloj | Mot klockan |
| Prep | Preparació | Preparación | Förberedelse |
| Fix it | Corregeix-la | Corrígela | Rätta till |
| Game analysis | Anàlisi de partides | Análisis de partidas | Partianalys |
| Blunder detective | Detectiu de cagades | Detective de errores | Blunderdetektiven |
| Which move | Quina jugada? | ¿Qué jugada? | Vilket drag? |
| Opponent scouting | Estudi de rivals | Estudio de rivales | Motståndaranalys |
| Builder | Editor de línies | Editor de líneas | Linjebyggare |
| Opening library | Biblioteca d'obertures | Biblioteca de aperturas | Öppningsbibliotek |
| Engine | Màquina | Máquina | Motor |
| Auto-reply | Auto-resposta | Respuesta automática | Autosvar |
| Recall (the % figure) | Encert | Acierto | Minne |
| Rating | Puntuació | Puntuación | Rating |
| Continue as a guest | Continua sense compte | Continuar sin cuenta | Fortsätt utan konto |
| Founding member | Membre d’honor | Acceso fundacional | Grundarmedlem |

## Chess words in the notes (mine, to check with club players)

| English | Catalan | Spanish | Swedish |
|---|---|---|---|
| castle / castling | enrocar, enroc | enrocar, enroque | rockera, rockad |
| file / rank | columna, fila | columna, fila | linje, rad |
| kingside / queenside | flanc de rei, flanc de dama | flanco de rey, flanco de dama | kungsflygel, damflygel |
| break (pawn) | ruptura | ruptura | brytning |
| tempo | temps | tiempo | tempo |
| bishop pair | parella d'alfils | pareja de alfiles | löparpar |
| passed pawn | peó passat | peón pasado | fribonde |
| isolated queen's pawn | peó de dama aïllat | peón de dama aislado | isolerad dambonde |
| pawn storm | allau de peons | avalancha de peones | bondestorm |
| minority attack | atac de minories | ataque de minorías | minoritetsangrepp |
| outpost | punt fort | puesto avanzado | utpost |
| the exchange (rook for minor) | la qualitat | la calidad | kvalitet |
| stalemate | ofegat | ahogado | patt |
| opposition | oposició | oposición | opposition |
| White, Black (the players) | les blanques, les negres | las blancas, las negras | vit, svart |

## Opening names we wrote ourselves

Starter pack lines and traps only. Spoken names, without *Defensa* or *Obertura* where a player would
drop them.

| English | Catalan | Spanish | Swedish |
|---|---|---|---|
| Italian | Italiana | Italiana | Italienskt |
| Two Knights | Dos Cavalls | Dos Caballos | Tvåspringarspel |
| Sicilian | Siciliana | Siciliana | Sicilianskt |
| French | Francesa | Francesa | Franskt |
| Scandinavian | Escandinava | Escandinava | Skandinaviskt |
| Petroff | Petrov | Petrov | Ryskt |
| London | Londres | Londres | London |
| King's Indian | Índia de rei | India de rey | Kungsindiskt |
| Ruy Lopez | Ruy López | Ruy López | Spanskt |
| Scotch | Escocesa | Escocesa | Skotskt |
| King's Gambit | Gambit de rei | Gambito de rey | Kungsgambit |
| Vienna | Vienesa | Vienesa | Wienerparti |
| Bishop's Opening | Obertura de l'alfil | Apertura de alfil | Löparspel |
| Four Knights | Quatre Cavalls | Cuatro Caballos | Fyrspringarspel |
| Centre Game | Joc del centre | Apertura del centro | Centrumspel |
| Slav | Eslava | Eslava | Slaviskt |
| Queen's Gambit Declined | Gambit de dama refusat, GDR | Gambito de dama rehusado, GDR | Avböjd damgambit |
| Catalan | Catalana | Catalana | Katalanskt |
| Exchange variation | Canvis | Cambios | Avbytesvarianten |
| Advance variation | Avanç | Avance | Framskjutningsvarianten |
| Fried Liver Attack | Atac Fegatello | Ataque Fegatello | Fried Liver-angreppet |

## Tactical themes (mine, to check with club players)

| English | Catalan | Spanish | Swedish |
|---|---|---|---|
| fork | forquilla | horquilla | gaffel |
| pin | clavada | clavada | bindning |
| skewer | enfilada | enfilada | spett |
| discovered attack | atac a la descoberta | ataque a la descubierta | avtäckt angrepp |
| deflection | desviació | desviación | avledning |
| attraction | atracció | atracción | inlockning |
| interference | interferència | interferencia | avspärrning |
| back-rank mate | mat a la darrera fila | mate del pasillo | baklinjematt |
| smothered mate | mat de la coça | mate de la coz | kvävmatt |
| time scramble | apurs de temps | apuros de tiempo | tidsnöd |
| traps | paranys | trampas | fällor |

## Tight spots

Marçal's phone test with the fake language, which runs about 40% longer than English:

| Where | Result | Real words to expect |
|---|---|---|
| Bottom menu, Statistics | Broke by one character | Estadístiques 13, Estadísticas 12, Statistik 9 letters |
| Train tabs, Openings | Broke by one character | Obertures, Aperturas, Öppningar: 9 |
| Train tabs, Middlegame | Broke by 4 or 5 | Mig joc 7, Medio juego 11, Mittspel 8 |
| Train tabs, Endgames | Broke by 2 | Finals 6, Finales 7, Slutspel 8 |

The real words are shorter than the fake ones, so they should fit, but check these on a phone
in each language. *Medio juego* has a space, so it can wrap. A shorter word comes before a smaller
font: don't shrink the text to make it fit.
