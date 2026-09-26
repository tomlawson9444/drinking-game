// Decks for Pub Poll, Spiked, Bullsh*t Interview, Pub Sort and Rap Battle.

// ------------------------------------------------------------------ Pub Poll (like Guesspionage)
// Real figures, rounded. Survey numbers vary between studies, so these are pub-quiz accurate.
export const POLLS = [
  { q: "What % of the Earth's surface is covered by water?", pct: 71 },
  { q: "What % of the air we breathe is nitrogen?", pct: 78 },
  { q: "What % of the air we breathe is oxygen?", pct: 21 },
  { q: "What % of people are left-handed?", pct: 10 },
  { q: "What % of people are genuinely ambidextrous?", pct: 1 },
  { q: "What % of the world's people have brown eyes?", pct: 79 },
  { q: "What % of an adult human's body is water?", pct: 60 },
  { q: "What % of a cucumber is water?", pct: 96 },
  { q: "What % of a jellyfish is water?", pct: 95 },
  { q: "What % of men are colour blind?", pct: 8 },
  { q: "What % of your brain do you actually use?", pct: 100, note: "The 10% thing is a myth" },
  { q: "What % of the Moon's surface can we see from Earth (over a month)?", pct: 59 },
  { q: "What % of the world's people live in the Northern Hemisphere?", pct: 88 },
  { q: "What % of the world's fresh water is locked up in ice and glaciers?", pct: 69 },
  { q: "What % of the world's people now live in towns and cities?", pct: 57 },
  { q: "What % of the world's people use the internet?", pct: 67 },
  { q: "What % of the world's people live in India?", pct: 18 },
  { q: "What % of the Earth's oxygen comes from the ocean?", pct: 50 },
  { q: "What % of the Sahara is sand dunes?", pct: 25 },
  { q: "What % of the UK's land is built on?", pct: 6 },
  { q: "What % of UK households have at least one car?", pct: 77 },
  { q: "What % of UK adults own a smartphone?", pct: 93 },
  { q: "What % of UK adults don't drink alcohol at all?", pct: 20 },
  { q: "What % of UK adults have a tattoo?", pct: 25 },
  { q: "What % of marriages in England and Wales end in divorce?", pct: 42 },
  { q: "What % of people in the UK have O-positive blood?", pct: 35 },
  { q: "What % of Scots have red hair?", pct: 13 },
  { q: "What % of babies are born on their due date?", pct: 4 },
  { q: "What % of people sneeze when they look at bright light?", pct: 25 },
  { q: "What % of people can roll their tongue?", pct: 70 },
  { q: "What % of your bones are in your hands and feet?", pct: 51 },
  { q: "What % of your body heat do you lose through your head?", pct: 10, note: "Your mum lied to you" },
  { q: "What % of an adult's body weight is skin?", pct: 16 },
  { q: "What % of DNA do humans share with chimpanzees?", pct: 99 },
  { q: "What % of our genes do we share with a banana (the famous claim)?", pct: 60 },
  { q: "What % of all mammal species are bats?", pct: 20 },
  { q: "What % of all known animal species are beetles?", pct: 25 },
  { q: "What % of passengers survived the Titanic?", pct: 32 },
  { q: "What % of people in plane crashes survive?", pct: 95 },
  { q: "In a famous study, what % of US drivers rated themselves above average?", pct: 93 },
  { q: "In a Gallup poll, what % of Americans said they believe in ghosts?", pct: 32 },
  { q: "In a Gallup poll, what % of Americans thought the Moon landing was faked?", pct: 6 },
  { q: "What's the alcohol % of a bottle of Smirnoff Red?", pct: 37.5 },
  { q: "What's the alcohol % of Jägermeister?", pct: 35 },
  { q: "What's the alcohol % of Baileys?", pct: 17 },
  { q: "What's the alcohol % of Buckfast?", pct: 15 },
  { q: "What's the alcohol % of Pimm's No. 1?", pct: 25 },
  { q: "What's the alcohol % of Jack Daniel's?", pct: 40 },
  { q: "What's the alcohol % of a pint of Guinness Draught?", pct: 4.2 },
];

// ------------------------------------------------------------------ Spiked (like Push the Button)
// [what the crew is asked, what the spiked player is asked]: close enough to blend in.
export const SPIKE_PAIRS = {
  mild: [
    ["Name something you'd take on a first date", "Name something you'd take camping"],
    ["What's a good name for a dog?", "What's a good name for a boat?"],
    ["Name something you'd find in a kitchen", "Name something you'd find in a garage"],
    ["Name a popular pizza topping", "Name something you'd put in a sandwich"],
    ["What would you buy with £100?", "What would you buy with £10,000?"],
    ["Name something that's sticky", "Name something that's slippery"],
    ["Name a job that needs a uniform", "Name a job you could do from home"],
    ["Name something you do on a Sunday morning", "Name something you do at 3am"],
    ["What's the worst thing to say at a wedding?", "What's the worst thing to say at a job interview?"],
    ["Name a reason to ring your mum", "Name a reason to ring the police"],
    ["Name something that goes in a Christmas stocking", "Name something you'd pack for a holiday"],
    ["Name a famous duo", "Name a famous rivalry"],
    ["What would you hate to hear from a pilot?", "What would you hate to hear from a hairdresser?"],
    ["Name a way to relax", "Name a way to get fit"],
    ["Name something round", "Name something that bounces"],
    ["Name a place you'd go on a stag or hen do", "Name a place you'd go on a school trip"],
    ["Name a smell you love", "Name a smell you hate"],
    ["Name a film that makes you cry", "Name a film that makes you laugh"],
    ["Name something you'd find in a handbag", "Name something you'd find in a glovebox"],
    ["What's a good excuse for being late?", "What's a good excuse for skipping the gym?"],
    ["Name something cold", "Name something wet"],
    ["Name a famous Scottish person", "Name a famous person with a beard"],
    ["Name a sound that wakes you up", "Name a sound that really annoys you"],
    ["Name something you'd see at the seaside", "Name something you'd see on a farm"],
    ["What's the best takeaway?", "What's the best hangover food?"],
    ["Name something you'd find at a car boot sale", "Name something you'd find in your nan's house"],
    ["Name a word to describe a baby", "Name a word to describe a potato"],
    ["What would you call a new pub?", "What would you call a racehorse?"],
    ["Name something you'd do on a rainy day", "Name something you'd do on a long train journey"],
    ["Name something in a first aid kit", "Name something in a bathroom cabinet"],
    ["Name a famous wizard", "Name a famous old man"],
    ["Name something that's orange", "Name something that's spicy"],
    ["Name a reason to cry", "Name a reason to scream"],
    ["Name a party game", "Name a game you'd play at Christmas"],
    ["Name something with wheels", "Name something with an engine"],
  ],
  filthy: [
    ["What's the best thing to shout at a football match?", "What's the best thing to shout in bed?"],
    ["Name something you'd find in a toolbox", "Name something you'd find in a sex shop"],
    ["Name something long", "Name something hard"],
    ["What would you whisper to a baby?", "What would you whisper to a lover?"],
    ["Name something you'd do in the shower", "Name something you'd do in a hot tub"],
    ["Name a vegetable", "Name something shaped like a willy"],
    ["What's a good name for a hamster?", "What's a good pet name for your partner's privates?"],
    ["What would you say to a nervous flyer?", "What would you say to a nervous virgin?"],
    ["Name something you'd rub", "Name something you'd lick"],
    ["What would you hate your boss to find?", "What would you hate your mum to find?"],
    ["Name something you do on a Friday night", "Name something you do on a first date"],
    ["Name something that comes in pairs", "Name something that jiggles"],
    ["What noise does a happy dog make?", "What noise do you make in bed?"],
    ["Name something you'd put whipped cream on", "Name something you'd put chocolate sauce on"],
    ["What would you say to a mechanic?", "What would you say during a quickie?"],
    ["Name something you'd find under a teenager's bed", "Name something you'd find in a hotel bin"],
    ["What's the worst thing to hear at the dentist?", "What's the worst thing to hear during sex?"],
    ["Name something that vibrates", "Name something you'd hide from your parents"],
    ["Name something wet", "Name something sticky"],
    ["What would you say to a waiter?", "What would you say to a stripper?"],
    ["Name something you'd do on holiday", "Name something you'd do on a dirty weekend"],
    ["Name something you'd tie up", "Name something you'd spank"],
    ["Name something that gets bigger", "Name something that gets harder"],
    ["Name something you'd blow", "Name something you'd suck"],
    ["What would you say to a crying child?", "What would you say after bad sex?"],
    ["Name something you keep in your bedside drawer", "Name something you'd hide from a burglar"],
    ["Name a reason you'd be up at 4am", "Name a reason you'd be sore the next day"],
    ["What's a good chat-up line?", "What's a good thing to say when you're caught cheating?"],
  ],
};

// ------------------------------------------------------------------ Bullsh*t Interview (like Job Job)
// Players answer icebreakers; their words become the tiles everyone builds interview answers from.
export const JOB_ICEBREAKERS = {
  mild: [
    "Describe your perfect night out.",
    "What's the worst thing you've ever eaten?",
    "Describe your dream holiday.",
    "What's your biggest pet hate?",
    "What did you have for dinner last night? In detail.",
    "Describe your ex in one sentence.",
    "What's the weirdest thing in your fridge right now?",
    "Tell us about your worst ever hangover.",
    "Describe your nan.",
    "What would you do with a million quid?",
    "What's your worst habit?",
    "Describe the last dream you remember.",
    "What's the best thing about Christmas?",
    "Describe your ideal partner.",
    "What's the weirdest thing you've ever googled?",
    "What would your last meal be?",
    "Describe your morning routine.",
    "Tell us about your first car.",
    "What do you do when nobody's watching?",
    "Describe the worst date you've been on.",
    "What's in your bag or pockets right now?",
    "Describe your bedroom.",
    "What's your party trick?",
    "What's the most useless fact you know?",
    "Describe your perfect sandwich.",
    "What would you say to the King if you met him?",
    "Describe the worst present you've ever been given.",
    "What's your go-to karaoke song, and why?",
    "Describe your dream house.",
    "What's the most rebellious thing you've ever done?",
    "Describe your group chat.",
    "What's the worst job you've ever had?",
  ],
  filthy: [
    "Describe your last snog.",
    "What's the dirtiest thing you've done on holiday?",
    "Describe your ideal one-night stand.",
    "What's the worst thing in your browser history?",
    "Describe the underwear you're wearing right now.",
    "What's the most embarrassing place you've had sex?",
    "Describe your worst walk of shame.",
    "What would you put on your dating profile if you had to be honest?",
    "Tell us about the last time you were caught doing something you shouldn't.",
    "Describe your moves in bed.",
    "What's the drunkest you've ever been?",
    "Describe your celebrity crush in filthy detail.",
  ],
};

export const JOB_QUESTIONS = {
  mild: [
    "Why do you want this job?",
    "What's your biggest weakness?",
    "Where do you see yourself in five years?",
    "Why did you leave your last job?",
    "Describe yourself in one sentence.",
    "What's your greatest achievement?",
    "How do you handle pressure?",
    "What makes you a good team player?",
    "Why should we hire you over everyone else?",
    "Tell us about a time you solved a problem.",
    "What would your last boss say about you?",
    "Do you have any questions for us?",
    "What are your salary expectations?",
    "How would your friends describe you?",
    "What are you most passionate about?",
    "What's your management style?",
    "How do you deal with difficult customers?",
    "What can you bring to the company?",
    "Tell us about a time you failed.",
    "What do you do in your spare time?",
  ],
  filthy: [
    "Why were you really fired from your last job?",
    "What would you do if you caught the boss shagging in the stationery cupboard?",
    "Tell us about your best work at the Christmas party.",
    "What's your biggest weakness in the bedroom?",
    "Why is there a two-year gap in your CV?",
    "How do you perform under pressure… in bed?",
    "What would HR say about you?",
    "Why did the police escort you out of your last job?",
  ],
};

// Little words everyone gets, so the tiles can make sentences.
export const JOB_FILLERS = ["I", "my", "the", "a", "and", "is", "very", "not", "with", "to", "of", "your", "because", "really"];

// ------------------------------------------------------------------ Pub Sort (like Quixort)
// Always sorted smallest first. Each round uses 5 items with different values.
export const SORT_SETS = [
  { q: "Oldest first: when did these films come out?", unit: "", items: [
    ["Jaws", 1975], ["Star Wars", 1977], ["Grease", 1978], ["E.T.", 1982], ["Ghostbusters", 1984], ["Back to the Future", 1985],
    ["Home Alone", 1990], ["Jurassic Park", 1993], ["The Lion King", 1994], ["Toy Story", 1995], ["Titanic", 1997], ["The Matrix", 1999],
    ["Shrek", 2001], ["Mamma Mia!", 2008], ["Avatar", 2009], ["Frozen", 2013], ["Barbie", 2023]] },
  { q: "Oldest first: when did these happen?", unit: "", items: [
    ["Battle of Hastings", 1066], ["Magna Carta", 1215], ["Great Fire of London", 1666], ["Titanic sinks", 1912], ["End of World War II", 1945],
    ["First people on top of Everest", 1953], ["England win the World Cup", 1966], ["Moon landing", 1969], ["UK goes decimal", 1971],
    ["Charles and Diana's wedding", 1981], ["Berlin Wall falls", 1989], ["Channel Tunnel opens", 1994], ["First iPhone", 2007],
    ["Brexit referendum", 2016], ["First Covid lockdown", 2020]] },
  { q: "Oldest first: when were these invented or launched?", unit: "", items: [
    ["Stephenson's Rocket", 1829], ["Telephone", 1876], ["Edison's light bulb", 1879], ["Wright brothers' plane", 1903],
    ["Baird's television", 1926], ["Penicillin", 1928], ["World Wide Web", 1989], ["PlayStation", 1994], ["Google", 1998],
    ["Facebook", 2004], ["YouTube", 2005], ["Twitter", 2006], ["Bitcoin", 2009], ["Instagram", 2010]] },
  { q: "Oldest first: when were these songs released?", unit: "", items: [
    ["Hey Jude", 1968], ["Sweet Caroline", 1969], ["Bohemian Rhapsody", 1975], ["Dancing Queen", 1976], ["I Will Survive", 1978],
    ["Livin' on a Prayer", 1986], ["Never Gonna Give You Up", 1987], ["Smells Like Teen Spirit", 1991], ["Wonderwall", 1995],
    ["Wannabe", 1996], ["Angels", 1997], ["...Baby One More Time", 1998], ["Mr. Brightside", 2003], ["Umbrella", 2007],
    ["Rolling in the Deep", 2010], ["Gangnam Style", 2012], ["Uptown Funk", 2014], ["Shape of You", 2017], ["Bad Guy", 2019]] },
  { q: "Oldest first: when did these TV shows start?", unit: "", items: [
    ["Blue Peter", 1958], ["Coronation Street", 1960], ["Doctor Who", 1963], ["Fawlty Towers", 1975], ["Only Fools and Horses", 1981],
    ["EastEnders", 1985], ["The Simpsons", 1989], ["Friends", 1994], ["Big Brother UK", 2000], ["The Office (UK)", 2001],
    ["Strictly Come Dancing", 2004], ["Gavin & Stacey", 2007], ["Breaking Bad", 2008], ["Great British Bake Off", 2010], ["Game of Thrones", 2011]] },
  { q: "Oldest first: when did these video games come out?", unit: "", items: [
    ["Pong", 1972], ["Pac-Man", 1980], ["Tetris", 1984], ["Super Mario Bros.", 1985], ["Sonic the Hedgehog", 1991], ["Pokémon Red & Green", 1996],
    ["GoldenEye 007", 1997], ["The Sims", 2000], ["GTA: San Andreas", 2004], ["Wii Sports", 2006], ["Angry Birds", 2009], ["Minecraft", 2011], ["Fortnite", 2017]] },
  { q: "Oldest first: when were these famous people born?", unit: "", items: [
    ["Queen Elizabeth II", 1926], ["Paul McCartney", 1942], ["Mick Jagger", 1943], ["Dolly Parton", 1946], ["King Charles", 1948],
    ["Madonna", 1958], ["David Beckham", 1975], ["Beyoncé", 1981], ["Prince William", 1982], ["Adele", 1988], ["Taylor Swift", 1989],
    ["Harry Styles", 1994], ["Billie Eilish", 2001], ["Prince George", 2013]] },
  { q: "Shortest first: how tall are these (in metres)?", unit: " m", items: [
    ["Angel of the North", 20], ["Christ the Redeemer (statue)", 30], ["Nelson's Column", 52], ["Leaning Tower of Pisa", 56],
    ["Statue of Liberty (with pedestal)", 93], ["Big Ben's tower", 96], ["Salisbury Cathedral spire", 123], ["London Eye", 135],
    ["Great Pyramid of Giza", 139], ["Blackpool Tower", 158], ["The Shard", 310], ["Eiffel Tower", 330], ["Empire State Building", 443], ["Burj Khalifa", 828]] },
  { q: "Lowest first: how high are these mountains (in metres)?", unit: " m", items: [
    ["Scafell Pike", 978], ["Carrauntoohil", 1039], ["Snowdon", 1085], ["Ben Nevis", 1345], ["Mount Fuji", 3776], ["Matterhorn", 4478],
    ["Mont Blanc", 4806], ["Kilimanjaro", 5895], ["K2", 8611], ["Everest", 8849]] },
  { q: "Fewest first: how many legs?", unit: " legs", items: [
    ["A snake", 0], ["A kangaroo", 2], ["A cat", 4], ["A bee", 6], ["A spider", 8], ["A crab", 10]] },
  { q: "Fewest first: players per team on the pitch", unit: " players", items: [
    ["Basketball", 5], ["Volleyball", 6], ["Netball", 7], ["Baseball", 9], ["Football", 11], ["Rugby league", 13], ["Rugby union", 15], ["Aussie rules", 18]] },
  { q: "Weakest first: typical alcohol strength", unit: "%", items: [
    ["WKD Blue", 4], ["Guinness Draught", 4.2], ["Prosecco", 11], ["Buckfast", 15], ["Baileys", 17], ["Pimm's No. 1", 25],
    ["Jägermeister", 35], ["Smirnoff Red", 37.5], ["Jack Daniel's", 40]] },
  { q: "Fewest first: how many people live there (millions)?", unit: "m", items: [
    ["Iceland", 0.4], ["Ireland", 5.2], ["Australia", 26], ["Canada", 39], ["The UK", 68], ["Germany", 84], ["Japan", 124],
    ["Brazil", 216], ["The USA", 335], ["India", 1430]] },
  { q: "Slowest first: top speed (mph)", unit: " mph", items: [
    ["A garden snail", 0.03], ["A person walking", 3], ["Usain Bolt", 28], ["A greyhound", 45], ["A cheetah", 70],
    ["A Formula 1 car", 230], ["Concorde", 1350]] },
  { q: "Closest first: distance from London as the crow flies (miles)", unit: " miles", items: [
    ["Brighton", 47], ["Cardiff", 131], ["Manchester", 163], ["Paris", 213], ["Edinburgh", 332], ["Rome", 890],
    ["New York", 3460], ["Tokyo", 5940], ["Sydney", 10560]] },
  { q: "Smallest first: put these numbers in order", unit: "", items: [
    ["Total spots on a dice", 21], ["Cards in a deck (no jokers)", 52], ["Squares on a chessboard", 64], ["Keys on a piano", 88],
    ["Maximum snooker break", 147], ["Maximum darts score with 3 darts", 180], ["Bones in an adult human", 206], ["Days in a leap year", 366]] },
];

// ------------------------------------------------------------------ Rap Battle (like Mad Verse City)
// A theme for the round, and an opening line each player has to finish with a rhyme.
export const RAP_THEMES = {
  mild: [
    "Why you're the best at the pub quiz", "Your nan's cooking", "The last train home", "Why you should rule this pub",
    "Diss the DJ", "The kebab shop at 3am", "Your worst holiday", "Monday mornings", "Why {player} can't dance",
    "{player}'s fashion sense", "The karaoke machine", "Self-service checkouts", "Your mum's Facebook posts",
    "Group chat drama", "Being skint before payday", "Your ex", "{player}'s cooking", "Why you're better than {player}",
    "The office Christmas party", "Hangovers",
  ],
  filthy: [
    "{player}'s love life", "The walk of shame", "{player}'s Tinder profile", "Beer fear", "Drunk texts",
    "Getting thrown out of Wetherspoons", "Your worst ever snog", "{player}'s bedroom skills", "Sex on the beach (the real thing)",
    "What {player} did last Christmas",
  ],
};

export const RAP_OPENERS = [
  { line: "I step to the mic with a pint in my hand", rhyme: "hand" },
  { line: "They call me the king of the local pub", rhyme: "pub" },
  { line: "I roll through the door and the whole place stops", rhyme: "stops" },
  { line: "Listen up, fools, I'm about to explain", rhyme: "explain" },
  { line: "I've been drinking since noon and I'm feeling fine", rhyme: "fine" },
  { line: "My rhymes are so hot they set off the alarms", rhyme: "alarms" },
  { line: "You think you can beat me? Mate, take a look", rhyme: "look" },
  { line: "Step aside, amateur, the master is here", rhyme: "here" },
  { line: "I don't need a mic and I don't need a stage", rhyme: "stage" },
  { line: "Ladies and gents, put your hands in the air", rhyme: "air" },
  { line: "I spit hotter bars than a kebab shop grill", rhyme: "grill" },
  { line: "I'm sharper than a pencil and cooler than ice", rhyme: "ice" },
  { line: "Pour me another, I'm just getting started", rhyme: "started" },
  { line: "Everyone's watching, the pressure is on", rhyme: "on" },
  { line: "I came here tonight with a point to prove", rhyme: "prove" },
  { line: "My flow is so smooth, it's like butter on toast", rhyme: "toast" },
  { line: "Don't make me laugh, you're a joke on a stick", rhyme: "stick" },
  { line: "I'm the best in this room and I'll say it again", rhyme: "again" },
  { line: "Hold my drink, it's time for the show", rhyme: "show" },
  { line: "I've got more bars than the high street at night", rhyme: "night" },
  { line: "I'm a legend round here, just ask the barmaid", rhyme: "barmaid" },
  { line: "Round one, ding ding, let's settle the score", rhyme: "score" },
  { line: "You brought a knife to a gunfight, you brought a shandy to a bar", rhyme: "bar" },
  { line: "I'm so good at this, I should be on telly", rhyme: "telly" },
];

// ------------------------------------------------------------------ Kings Cup (Ring of Fire)
// What each card means. `act` is what the phones do: pick someone, a tap race, write a rule, or nothing.
export const KINGS_RULES = {
  A: { name: "Waterfall", rule: "Everyone drinks! Start together; you can't stop until the person on your right stops.", act: null },
  2: { name: "You", rule: "Pick someone to drink 2.", act: "pick" },
  3: { name: "Me", rule: "The drawer drinks 2.", act: null },
  4: { name: "Floor", rule: "Everyone tap FLOOR on your phone (and touch the floor!). Slowest drinks.", act: "tap", button: "👇 FLOOR!" },
  5: { name: "Thumb Master", rule: "The drawer is Thumb Master: when they put a thumb on the table, last to copy drinks.", act: null },
  6: { name: "Social", rule: "Cheers! Everybody drinks.", act: null },
  7: { name: "Heaven", rule: "Everyone tap HEAVEN on your phone (and point up!). Slowest drinks.", act: "tap", button: "🙌 HEAVEN!" },
  8: { name: "Mate", rule: "Pick a mate: they drink whenever you drink, for the rest of the game.", act: "mate" },
  9: { name: "Rhyme", rule: "Go round the room rhyming with the word on screen. The drawer picks who fluffed it.", act: "loser" },
  10: { name: "Categories", rule: "Go round the room naming things in the category on screen. The drawer picks who fluffed it.", act: "loser" },
  J: { name: "Make a Rule", rule: "The drawer makes a house rule.", act: "rule" },
  Q: { name: "Question Master", rule: "The drawer is Question Master: answer any of their questions and you drink.", act: null },
  K: { name: "King's Cup", rule: "Pour some of your drink into the King's Cup. Whoever draws the 4th king downs it!", act: null },
};
export const KINGS_RHYMES = ["pint", "bar", "night", "drink", "beer", "kebab", "shot", "round", "wine", "cheers", "pub", "dance", "chips", "taxi", "Friday"];
export const KINGS_CATEGORIES = [
  "Beers", "Cocktails", "Crisp flavours", "Premier League clubs", "Things in a kebab shop", "Pub names", "Spice Girls songs",
  "Things you'd find in a handbag", "Words for being drunk", "Chocolate bars", "Soap opera characters", "Takeaways",
  "Boy bands", "Car makes", "Countries in Europe", "Harry Potter characters", "Things that are yellow", "Disney films",
];

// ------------------------------------------------------------------ Hot Potato Bomb
export const BOMB_CATEGORIES = {
  mild: [
    "Beers", "Cocktails", "Crisp flavours", "Premier League clubs", "Things in a kebab shop", "Chocolate bars",
    "Words for being drunk", "Takeaway food", "Car makes", "Countries in Europe", "Capital cities", "Disney films",
    "Harry Potter characters", "Boy bands and girl bands", "Things that are yellow", "Supermarkets", "Breakfast cereals",
    "Dog breeds", "Soap opera characters", "Things in a bathroom", "Board games", "Pizza toppings", "Cheeses",
    "Christmas songs", "Things you take on holiday", "Sports", "Animals in a zoo", "Fruit", "Vegetables",
    "Spirits (the drinking kind)", "Famous Davids", "Things with wheels", "Shops on the high street", "Card games",
    "Things that are cold", "Types of shoe", "Pixar films", "London Underground stations", "Rappers", "Sandwich fillings",
  ],
  filthy: [
    "Words for a willy", "Words for boobs", "Sex positions", "Places you've had sex", "Things in a sex shop",
    "Chat-up lines", "Words for being horny", "Things you'd hide from your mum", "Excuses for a hangover",
    "Things you'd shout in bed", "Words for a bum", "Dating app red flags",
  ],
};

// ------------------------------------------------------------------ Pub Telephone
// Placeholder ideas for the first line, if someone's stuck.
export const TELE_IDEAS = [
  "A pigeon robbing a Greggs", "Your nan winning a rap battle", "A horse at a job interview", "Batman stuck in a revolving door",
  "The King doing the worm", "A kebab on its wedding day", "A shark in a hot tub", "Two ghosts on a first date",
  "A dog driving a bus", "A snowman in a sauna", "A vicar at a rave", "A giraffe in a lift", "A toddler running a pub",
  "A caveman using an iPhone", "A penguin at a nightclub", "Shrek at the dentist", "A granny on a skateboard",
];

// ------------------------------------------------------------------ Fastest Finger
export const FAST_GO = "🍺";
export const FAST_TRAPS = ["🥛", "🧃", "☕", "🚰"];
