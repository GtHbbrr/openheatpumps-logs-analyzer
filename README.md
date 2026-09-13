# OpenHeatPumps Logs Analyzer 🚀

Welkom bij OpenHeatPumps.nl! Dit is een onafhankelijke en gebruiksvriendelijke hulpkit voor bezitters van een slimme warmtepomp (zoals de Quatt). 

Wanneer een warmtepomp niet goed werkt, maakt de computer van de warmtepomp een groot databestand aan (een zogenaamd logbestand). Voor gewone mensen zijn deze bestanden onleesbaar. Deze website lost dat op. Je sleept het bestand simpelweg naar de website, en onze ingebouwde AI-assistent legt je in begrijpelijk Nederlands uit wat er aan de hand is.

---

## 🛠️ Hoe werkt de website nu?

De website bestaat uit twee delen die veilig in de cloud samenwerken:

1.  **De Voorkant (Website):** Een overzichtelijke, webpagina. Met de knop "Koppel Log-map" zoekt de website automatisch het nieuwste logbestand op je computer. Je kunt het bestand er ook gewoon naartoe slepen.
2.  **De Achterkant (De Slimme Motor):** Dit deeltje praat veilig met de kunstmatige intelligentie (AI) van Google Gemini. De motor leest de cijfers uit je logbestand en stuurt de begrijpelijke analyse terug naar jouw scherm. 

Sinds de laatste update heeft de slimme motor een betrouwbaar 'geheugen' gekregen. We hebben de officiële handleidingen van de warmtepomp in dit geheugen opgeslagen. Als jij een vraag stelt over bijvoorbeeld de pompsnelheid, controleert de computer eerst de officiële regels voordat hij antwoord geeft. Hierdoor verzint de AI geen gekke dingen meer en krijg je altijd een betrouwbaar advies.

## 🗺️ Wat gaan we in de toekomst verbeteren? (De Roadmap)

Om de AI-assistent nog slimmer en betrouwbaarder te maken, breiden we de achterkant van de website stap voor stap uit. De gebruiker hoeft hier niets van te merken; het slepen van het bestand blijft het enige wat je hoeft te doen.

### 📍 Fase 2: Lokaal geheugen opbouwen
*   **Het doel:** Vragen kunnen beantwoorden zoals: *"Waarom verbruikt mijn pomp nu meer stroom dan vorige week?"*
*   **Hoe we dit doen:** De website onthoudt anoniem de belangrijkste cijfers van de logs die je uploadt. Hierdoor kan de AI trends ontdekken en jouw warmtepomp-gedrag door de tijd heen vergelijken.

### 📍 Fase 3: Het slimme RAG-geheugen (Nu actief in de testomgeving!)
*   **Het doel:** Voorkomen dat de AI fout advies geeft of interfaces verzint die niet bestaan.
*   **Hoe we dit doen:** We hebben een digitale bibliotheek (een vector-database) gekoppeld aan de website. Hierin staan de officiële installatieregels en de handleidingen van de makers. Voordat de AI antwoord geeft op een vervolgvraag, leest hij eerst razendsnel de echte regels door.

### 📍 Fase 4: De Power House & Expert-regels toevoegen
*   **Het doel:** De AI precies laten begrijpen waarom de warmtepomp op bepaalde momenten hard gaat draaien of juist stopt.
*   **Hoe we dit doen:** We voeden de digitale bibliotheek met de wetten van de 'Power House-strategie'. De AI leert hierdoor dat de warmtepomp niet op ouderwetse temperatuurlijnen werkt, maar op basis van slimme berekeningen rondom huisverlies en de 'start-intentie' (Heat Intent). 

### 📍 Fase 5: Installaties met elkaar vergelijken
*   **Het doel:** Leren van andere warmtepomp-bezitters.
*   **Hoe we dit doen:** De AI kan anoniem installaties met exact dezelfde kenmerken (bijvoorbeeld: een tussenwoning met radiatoren en een Intergas-ketel) naast elkaar leggen. Je krijgt dan direct advies zoals: *"Bij jouw buren met hetzelfde huis springt de CV-ketel veel minder vaak bij. Controleer instelling X."*

---

## 🔒 Privacy & Veiligheid (Hoe we met je data omgaan)

Bij OpenHeatPumps.nl houden we van transparantie. Dit is hoe we nu met je gegevens omgaan:

*   **Het logbestand gaat naar de AI:** Om een goede en volledige diagnose te kunnen stellen, wordt de inhoud van jouw `.oqdebug.json` bestand op dit moment **integraal (helemaal) meegestuurd** naar de AI-assistent. De AI heeft al deze cijfers en metingen simpelweg nodig om te kunnen ontdekken waarom je warmtepomp vreemd gedrag vertoont.
*   **Geen accounts of permanente opslag:** We bewaren je bestanden **niet** in een database op internet. Er zijn geen gebruikersaccounts en we bouwen geen stiekem archief op met logs van de community.
*   **Direct weer weg:** Alles draait in het tijdelijke geheugen van de internetbrowser en de tijdelijke cloud-aanroep. Zodra je het tabblad sluit of de website ververst, zijn alle gegevens direct volledig verdwenen.

---


## 💻 Meehelpen?

Dit project is gemaakt voor en door warmtepomp-bezitters die van duidelijke taal houden. Heb je ideeën om de website nog simpeler te maken of wil je meebouwen aan de cloud-motor? Open dan een Issue of Pull Request op GitHub!
