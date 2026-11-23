// ---------------------------------------------------------------------------
// src/careerDb.js — Real-world clubs, managers, tactical identities, 5-pattern
// kits, 5 top European leagues, 32 National Teams, and squad rosters.
// Deterministic, zero network calls, zero Math.random().
// ---------------------------------------------------------------------------

export const TACTICAL_STYLES = {
  low_block: {
    id: 'low_block',
    name: 'Low-Block Counter',
    short: 'LOW BLOCK',
    formation: '4-4-2',
    desc: 'Deep defensive line, compact midfield shield, rapid vertical counters.',
    lineShift: -8.5,
    pressDist: 8.5,
    pressBoost: 0.86,
    staminaDrain: 0.90,
    longBallBias: 0.36,
    counterSpeed: 1.24,
    passTempo: 0.92,
    width: 0.62,
    simAtt: -0.04,
    simDef: 0.14,
  },
  possession: {
    id: 'possession',
    name: 'Possession & High Press',
    short: 'POSSESSION',
    formation: '4-3-3',
    desc: 'High defensive line, short passing triangles, aggressive counter-press.',
    lineShift: 6.8,
    pressDist: 16.5,
    pressBoost: 1.12,
    staminaDrain: 1.08,
    longBallBias: 0.08,
    counterSpeed: 1.02,
    passTempo: 1.18,
    width: 0.94,
    simAtt: 0.13,
    simDef: 0.04,
  },
  gegenpress: {
    id: 'gegenpress',
    name: 'Gegenpress / Vertical',
    short: 'GEGENPRESS',
    formation: '4-2-3-1',
    desc: 'Relentless pressing traps, fast vertical transitions, higher stamina burn.',
    lineShift: 5.5,
    pressDist: 20.5,
    pressBoost: 1.24,
    staminaDrain: 1.18,
    longBallBias: 0.22,
    counterSpeed: 1.28,
    passTempo: 1.14,
    width: 0.86,
    simAtt: 0.14,
    simDef: -0.02,
  },
  balanced: {
    id: 'balanced',
    name: 'Balanced Transition',
    short: 'BALANCED',
    formation: '4-3-3',
    desc: 'Pragmatic, adaptive shape balancing midfield control and swift breaks.',
    lineShift: 0.5,
    pressDist: 13.0,
    pressBoost: 1.00,
    staminaDrain: 1.00,
    longBallBias: 0.18,
    counterSpeed: 1.08,
    passTempo: 1.02,
    width: 0.82,
    simAtt: 0.05,
    simDef: 0.05,
  },
  route_one: {
    id: 'route_one',
    name: 'Route One / Physical',
    short: 'ROUTE ONE',
    formation: '4-4-2',
    desc: 'Direct long balls into target men, physical duels, aerial dominance.',
    lineShift: -4.5,
    pressDist: 10.5,
    pressBoost: 0.98,
    staminaDrain: 1.04,
    longBallBias: 0.62,
    counterSpeed: 1.10,
    passTempo: 0.88,
    width: 0.72,
    simAtt: 0.02,
    simDef: 0.06,
  },
};

// Style matchup modifier (attStyle vs defStyle) for simulation xG
export const TACTIC_MATCHUP = {
  low_block: { possession: 0.10, gegenpress: 0.08, balanced: 0.0, route_one: -0.03, low_block: -0.05 },
  possession: { low_block: -0.08, route_one: 0.08, balanced: 0.04, gegenpress: -0.04, possession: 0.0 },
  gegenpress: { possession: 0.05, balanced: 0.06, route_one: 0.05, low_block: -0.07, gegenpress: 0.02 },
  balanced: { low_block: 0.03, possession: -0.02, gegenpress: -0.02, route_one: 0.04, balanced: 0.0 },
  route_one: { low_block: 0.04, gegenpress: -0.04, possession: -0.05, balanced: -0.02, route_one: 0.0 },
};

export const LEAGUES = [
  { id: 'eng', name: 'Premier League', country: 'England', cupName: 'FA Cup', leagueCupName: 'EFL Cup', uclSpots: 4, uelSpots: 2, clubCount: 20 },
  { id: 'esp', name: 'La Liga', country: 'Spain', cupName: 'Copa del Rey', leagueCupName: 'Copa de la Liga', uclSpots: 4, uelSpots: 2, clubCount: 20 },
  { id: 'ita', name: 'Serie A', country: 'Italy', cupName: 'Coppa Italia', leagueCupName: 'Coppa Lega', uclSpots: 4, uelSpots: 2, clubCount: 20 },
  { id: 'ger', name: 'Bundesliga', country: 'Germany', cupName: 'DFB-Pokal', leagueCupName: 'Ligapokal', uclSpots: 4, uelSpots: 2, clubCount: 18 },
  { id: 'fra', name: 'Ligue 1', country: 'France', cupName: 'Coupe de France', leagueCupName: 'Coupe de la Ligue', uclSpots: 3, uelSpots: 2, clubCount: 18 },
];

export const POSITIONS = ['ST', 'LW', 'RW', 'CAM', 'CM', 'CDM', 'LB', 'RB', 'CB', 'GK'];

export function posToEngineRole(pos) {
  if (pos === 'GK') return 'GK';
  if (pos === 'CB' || pos === 'LB' || pos === 'RB') return 'DF';
  if (pos === 'CDM' || pos === 'CM' || pos === 'CAM') return 'MF';
  return 'FW';
}

function hashStr(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function makeDetRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexLum(hex) {
  const n = parseInt((hex || '#000000').replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function mkKit(primary, secondary, pattern = 'solid', shorts = primary, socks = primary, numColor = null) {
  const autoNum = numColor || (hexLum(primary) > 0.56 ? '#14171f' : '#f8fafc');
  return { primary, secondary, pattern, shorts, socks, numColor: autoNum };
}

function mkClub(id, leagueId, name, short, abbr, rating, mgrName, mgrRating, style, homeKit, awayKit, gkColor, stars) {
  return {
    id, leagueId, type: 'club', name, short, abbr, rating,
    manager: { name: mgrName, tacticalRating: mgrRating, style },
    homeKit, awayKit,
    gkKit: mkKit(gkColor, '#14171f', 'solid', '#14171f', gkColor),
    stars,
  };
}

// ---------------------------------------------------------------------------
// 5 Top Leagues (96 real-world clubs)
// ---------------------------------------------------------------------------
const RAW_CLUBS = [
  // ENGLAND — Premier League (20)
  mkClub('ars', 'eng', 'Arsenal', 'Arsenal', 'ARS', 88, 'Mikel Arteta', 89, 'possession',
    mkKit('#dc1c24', '#ffffff', 'sleeves', '#ffffff', '#dc1c24'),
    mkKit('#151a24', '#38bdf8', 'solid', '#151a24', '#151a24'), '#facc15',
    [['Bukayo Saka', 'RW', 88, 7, 'England'], ['Martin Odegaard', 'CAM', 88, 8, 'Norway'], ['Viktor Gyokeres', 'ST', 87, 14, 'Sweden'], ['Declan Rice', 'CDM', 88, 41, 'England'], ['Martin Zubimendi', 'CDM', 86, 36, 'Spain'], ['William Saliba', 'CB', 88, 2, 'France'], ['Gabriel Magalhaes', 'CB', 87, 6, 'Brazil'], ['Eberechi Eze', 'CAM', 85, 10, 'England'], ['Jurrien Timber', 'RB', 84, 12, 'Netherlands'], ['David Raya', 'GK', 87, 1, 'Spain']]),
  mkClub('mci', 'eng', 'Manchester City', 'Man City', 'MCI', 87, 'Enzo Maresca', 85, 'possession',
    mkKit('#6cabdd', '#ffffff', 'solid', '#ffffff', '#6cabdd'),
    mkKit('#1f2937', '#facc15', 'stripes', '#1f2937', '#1f2937'), '#f97316',
    [['Erling Haaland', 'ST', 92, 9, 'Norway'], ['Phil Foden', 'RW', 87, 47, 'England'], ['Ruben Dias', 'CB', 88, 3, 'Portugal'], ['Josko Gvardiol', 'LB', 86, 24, 'Croatia'], ['Gianluigi Donnarumma', 'GK', 89, 1, 'Italy'], ['Rayan Cherki', 'CAM', 84, 10, 'France'], ['Tijjani Reijnders', 'CM', 84, 4, 'Netherlands'], ['Marc Guehi', 'CB', 84, 6, 'England'], ['Omar Marmoush', 'LW', 84, 7, 'Egypt']]),
  mkClub('liv', 'eng', 'Liverpool', 'Liverpool', 'LIV', 87, 'Andoni Iraola', 86, 'gegenpress',
    mkKit('#c8102e', '#ffffff', 'solid', '#c8102e', '#c8102e'),
    mkKit('#f2f4f8', '#15171c', 'sleeves', '#15171c', '#f2f4f8'), '#22c55e',
    [['Florian Wirtz', 'CAM', 89, 7, 'Germany'], ['Alexander Isak', 'ST', 88, 9, 'Sweden'], ['Virgil van Dijk', 'CB', 88, 4, 'Netherlands'], ['Mohamed Salah', 'RW', 87, 11, 'Egypt'], ['Alisson Becker', 'GK', 88, 1, 'Brazil'], ['Alexis Mac Allister', 'CM', 86, 10, 'Argentina'], ['Jeremie Frimpong', 'RB', 85, 30, 'Netherlands'], ['Ryan Gravenberch', 'CDM', 84, 38, 'Netherlands'], ['Hugo Ekitike', 'ST', 83, 22, 'France'], ['Milos Kerkez', 'LB', 82, 6, 'Hungary']]),
  mkClub('che', 'eng', 'Chelsea', 'Chelsea', 'CHE', 85, 'Xabi Alonso', 87, 'possession',
    mkKit('#034694', '#ffffff', 'solid', '#034694', '#ffffff'),
    mkKit('#f5efe0', '#d97706', 'sash', '#f5efe0', '#f5efe0'), '#facc15',
    [['Cole Palmer', 'CAM', 88, 10, 'England'], ['Moises Caicedo', 'CDM', 86, 25, 'Ecuador'], ['Enzo Fernandez', 'CM', 84, 8, 'Argentina'], ['Morgan Rogers', 'LW', 82, 17, 'England'], ['Pedro Neto', 'RW', 82, 7, 'Portugal'], ['Levi Colwill', 'CB', 82, 6, 'England'], ['Malo Gusto', 'RB', 82, 27, 'France'], ['Jorrel Hato', 'CB', 81, 21, 'Netherlands'], ['Robert Sanchez', 'GK', 80, 1, 'Spain']]),
  mkClub('mun', 'eng', 'Manchester United', 'Man Utd', 'MUN', 83, 'Mauricio Pochettino', 83, 'gegenpress',
    mkKit('#da291c', '#141414', 'solid', '#ffffff', '#141414'),
    mkKit('#1a2744', '#93c5fd', 'solid', '#1a2744', '#1a2744'), '#22c55e',
    [['Bruno Fernandes', 'CAM', 87, 8, 'Portugal'], ['Matheus Cunha', 'ST', 84, 10, 'Brazil'], ['Bryan Mbeumo', 'RW', 83, 19, 'Cameroon'], ['Carlos Baleba', 'CDM', 83, 20, 'Cameroon'], ['Lisandro Martinez', 'CB', 84, 6, 'Argentina'], ['Matthijs de Ligt', 'CB', 83, 4, 'Netherlands'], ['Kobbie Mainoo', 'CM', 82, 37, 'England'], ['Amad Diallo', 'LW', 82, 16, 'Ivory Coast'], ['Senne Lammens', 'GK', 81, 1, 'Belgium']]),
  mkClub('tot', 'eng', 'Tottenham Hotspur', 'Tottenham', 'TOT', 83, 'Roberto De Zerbi', 83, 'possession',
    mkKit('#f4f6f8', '#132257', 'sleeves', '#132257', '#f4f6f8'),
    mkKit('#0c1e3a', '#7dd3fc', 'stripes', '#0c1e3a', '#0c1e3a'), '#f59e0b',
    [['Xavi Simons', 'CAM', 85, 7, 'Netherlands'], ['Sandro Tonali', 'CDM', 85, 16, 'Italy'], ['Dejan Kulusevski', 'RW', 84, 21, 'Sweden'], ['Micky van de Ven', 'CB', 84, 37, 'Netherlands'], ['Mohammed Kudus', 'RW', 83, 20, 'Ghana'], ['Dominic Solanke', 'ST', 82, 19, 'England'], ['Conor Gallagher', 'CM', 82, 8, 'England'], ['Pedro Porro', 'RB', 82, 23, 'Spain'], ['Andy Robertson', 'LB', 82, 3, 'Scotland'], ['Antonin Kinsky', 'GK', 79, 31, 'Czech Republic']]),
  mkClub('avl', 'eng', 'Aston Villa', 'Aston Villa', 'AVL', 82, 'Unai Emery', 84, 'balanced',
    mkKit('#670e36', '#95bfe5', 'sleeves', '#ffffff', '#95bfe5'),
    mkKit('#f4f6f8', '#670e36', 'solid', '#141416', '#f4f6f8'), '#facc15',
    [['Ollie Watkins', 'ST', 84, 11, 'England'], ['Leon Goretzka', 'CM', 82, 27, 'Germany'], ['Amadou Onana', 'CDM', 82, 24, 'Belgium'], ['Pau Torres', 'CB', 82, 14, 'Spain'], ['Youri Tielemans', 'CM', 82, 8, 'Belgium'], ['Nicolas Jackson', 'ST', 81, 9, 'Senegal'], ['Alejandro Garnacho', 'LW', 81, 17, 'Argentina'], ['Zion Suzuki', 'GK', 79, 1, 'Japan']]),
  mkClub('new', 'eng', 'Newcastle United', 'Newcastle', 'NEW', 81, 'Matthias Jaissle', 81, 'gegenpress',
    mkKit('#141416', '#f4f6f8', 'stripes', '#141416', '#141416'),
    mkKit('#7c1d3d', '#93c5fd', 'hoops', '#7c1d3d', '#7c1d3d'), '#22c55e',
    [['Yoane Wissa', 'ST', 82, 9, 'DR Congo'], ['Joelinton', 'CM', 82, 7, 'Brazil'], ['Sven Botman', 'CB', 82, 4, 'Netherlands'], ['Harvey Barnes', 'LW', 81, 11, 'England'], ['Tino Livramento', 'RB', 81, 2, 'England'], ['Anthony Elanga', 'RW', 80, 19, 'Sweden'], ['Lewis Hall', 'LB', 80, 3, 'England'], ['Nick Pope', 'GK', 82, 1, 'England']]),
  mkClub('nfo', 'eng', 'Nottingham Forest', 'N. Forest', 'NFO', 79, 'Oliver Glasner', 81, 'low_block',
    mkKit('#dd0000', '#ffffff', 'solid', '#ffffff', '#dd0000'),
    mkKit('#1e293b', '#38bdf8', 'solid', '#1e293b', '#1e293b'), '#22c55e',
    [['Morgan Gibbs-White', 'CAM', 82, 10, 'England'], ['Murillo', 'CB', 81, 5, 'Brazil'], ['Elliot Anderson', 'CM', 80, 8, 'England'], ['Chris Wood', 'ST', 79, 11, 'New Zealand'], ['Matz Sels', 'GK', 80, 26, 'Belgium']]),
  mkClub('bha', 'eng', 'Brighton', 'Brighton', 'BHA', 79, 'Fabian Hurzeler', 80, 'possession',
    mkKit('#0057b8', '#ffffff', 'stripes', '#0057b8', '#0057b8'),
    mkKit('#eab308', '#111827', 'stripes', '#111827', '#eab308'), '#22c55e',
    [['Kaoru Mitoma', 'LW', 83, 22, 'Japan'], ['Luka Vuskovic', 'CB', 79, 4, 'Croatia'], ['Lewis Dunk', 'CB', 79, 5, 'England'], ['Pascal Struijk', 'CB', 78, 2, 'Netherlands'], ['Chema Andres', 'CDM', 77, 6, 'Spain'], ['Bart Verbruggen', 'GK', 81, 1, 'Netherlands']]),
  mkClub('bou', 'eng', 'Bournemouth', 'Bournemouth', 'BOU', 79, 'Marco Rose', 80, 'gegenpress',
    mkKit('#b50e12', '#141414', 'stripes', '#141414', '#b50e12'),
    mkKit('#f4f6f8', '#7c3aed', 'sash', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Antoine Semenyo', 'RW', 82, 24, 'Ghana'], ['Antonio Silva', 'CB', 81, 4, 'Portugal'], ['Justin Kluivert', 'CAM', 80, 19, 'Netherlands'], ['Alex Scott', 'CM', 79, 8, 'England'], ['Eli Junior Kroupi', 'ST', 78, 22, 'France'], ['Djordje Petrovic', 'GK', 79, 1, 'Serbia']]),
  mkClub('cry', 'eng', 'Crystal Palace', 'C. Palace', 'CRY', 78, 'Thomas Frank', 80, 'balanced',
    mkKit('#1b458f', '#c4122e', 'stripes', '#1b458f', '#1b458f'),
    mkKit('#f4f6f8', '#c4122e', 'sash', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Adam Wharton', 'CDM', 81, 20, 'England'], ['Jean-Philippe Mateta', 'ST', 81, 14, 'France'], ['Quinten Timber', 'CM', 79, 8, 'Netherlands'], ['Brennan Johnson', 'RW', 79, 22, 'Wales'], ['Oscar Mingueza', 'RB', 78, 2, 'Spain'], ['Dean Henderson', 'GK', 80, 1, 'England']]),
  mkClub('eve', 'eng', 'Everton', 'Everton', 'EVE', 77, 'David Moyes', 79, 'route_one',
    mkKit('#003399', '#ffffff', 'solid', '#ffffff', '#003399'),
    mkKit('#141416', '#facc15', 'solid', '#141416', '#141416'), '#facc15',
    [['Jordan Pickford', 'GK', 83, 1, 'England'], ['Jarrad Branthwaite', 'CB', 82, 32, 'England'], ['Jack Grealish', 'LW', 80, 10, 'England'], ['Iliman Ndiaye', 'CAM', 79, 18, 'Senegal'], ['Dwight McNeil', 'RW', 78, 7, 'England']]),
  mkClub('bre', 'eng', 'Brentford', 'Brentford', 'BRE', 77, 'Keith Andrews', 78, 'route_one',
    mkKit('#e30613', '#ffffff', 'stripes', '#141414', '#141414'),
    mkKit('#ec4899', '#1f2937', 'solid', '#1f2937', '#ec4899'), '#22c55e',
    [['Igor Thiago', 'ST', 80, 9, 'Brazil'], ['Mamadou Sangare', 'CDM', 79, 6, 'Mali'], ['Mikkel Damsgaard', 'CAM', 79, 24, 'Denmark'], ['Nathan Collins', 'CB', 78, 22, 'Ireland'], ['Caoimhin Kelleher', 'GK', 79, 1, 'Ireland']]),
  mkClub('ful', 'eng', 'Fulham', 'Fulham', 'FUL', 77, 'Alvaro Arbeloa', 78, 'balanced',
    mkKit('#f4f6f8', '#141414', 'solid', '#141414', '#f4f6f8'),
    mkKit('#991b1b', '#141414', 'stripes', '#141414', '#991b1b'), '#facc15',
    [['Emile Smith Rowe', 'CAM', 79, 32, 'England'], ['Antonee Robinson', 'LB', 80, 33, 'USA'], ['Raul Jimenez', 'ST', 78, 7, 'Mexico'], ['Calvin Bassey', 'CB', 78, 3, 'Nigeria'], ['Bernd Leno', 'GK', 81, 1, 'Germany']]),
  mkClub('sun', 'eng', 'Sunderland', 'Sunderland', 'SUN', 77, 'Regis Le Bris', 78, 'balanced',
    mkKit('#eb172b', '#ffffff', 'stripes', '#141414', '#eb172b'),
    mkKit('#1e293b', '#38bdf8', 'solid', '#1e293b', '#1e293b'), '#22c55e',
    [['Granit Xhaka', 'CDM', 83, 34, 'Switzerland'], ['Brian Brobbey', 'ST', 79, 9, 'Netherlands'], ['Malick Fofana', 'LW', 79, 11, 'Belgium'], ['Enzo Le Fee', 'CM', 78, 8, 'France'], ['Robin Roefs', 'GK', 77, 1, 'Netherlands']]),
  mkClub('lee', 'eng', 'Leeds United', 'Leeds', 'LEE', 76, 'Daniel Farke', 77, 'gegenpress',
    mkKit('#f4f6f8', '#ffcd00', 'solid', '#f4f6f8', '#f4f6f8'),
    mkKit('#1d4ed8', '#ffcd00', 'solid', '#1d4ed8', '#1d4ed8'), '#22c55e',
    [['Harry Wilson', 'RW', 79, 7, 'Wales'], ['Dominic Calvert-Lewin', 'ST', 78, 9, 'England'], ['Ethan Ampadu', 'CDM', 78, 4, 'Wales'], ['Ao Tanaka', 'CM', 77, 22, 'Japan'], ['James Trafford', 'GK', 79, 1, 'England']]),
  mkClub('cov', 'eng', 'Coventry City', 'Coventry', 'COV', 74, 'Frank Lampard', 76, 'balanced',
    mkKit('#57b6e6', '#ffffff', 'stripes', '#57b6e6', '#57b6e6'),
    mkKit('#1e293b', '#57b6e6', 'solid', '#1e293b', '#1e293b'), '#facc15',
    [['Haji Wright', 'ST', 77, 11, 'USA'], ['Jack Rudoni', 'CAM', 75, 5, 'England'], ['Bobby Thomas', 'CB', 74, 4, 'England'], ['Carl Rushworth', 'GK', 75, 1, 'England']]),
  mkClub('ips', 'eng', 'Ipswich Town', 'Ipswich', 'IPS', 74, 'Gary O-Neil', 76, 'gegenpress',
    mkKit('#0044a9', '#ffffff', 'solid', '#ffffff', '#0044a9'),
    mkKit('#4b1c2e', '#f8fafc', 'solid', '#4b1c2e', '#4b1c2e'), '#22c55e',
    [['Leif Davis', 'LB', 76, 3, 'England'], ['Sammie Szmodics', 'CAM', 75, 23, 'Ireland'], ['Jacob Greaves', 'CB', 75, 24, 'England'], ['Alex Palmer', 'GK', 75, 1, 'England']]),
  mkClub('hul', 'eng', 'Hull City', 'Hull City', 'HUL', 73, 'Sergej Jakirovic', 74, 'low_block',
    mkKit('#f59e0b', '#141414', 'stripes', '#141414', '#f59e0b'),
    mkKit('#141416', '#f59e0b', 'solid', '#141416', '#141416'), '#22c55e',
    [['Joe Gelhardt', 'ST', 74, 10, 'England'], ['Mohamed Belloumi', 'RW', 74, 7, 'Algeria'], ['Charlie Hughes', 'CB', 73, 4, 'England'], ['Ivor Pandur', 'GK', 74, 1, 'Croatia']]),

  // SPAIN — La Liga (20)
  mkClub('rma', 'esp', 'Real Madrid', 'Real Madrid', 'RMA', 89, 'Jose Mourinho', 89, 'balanced',
    mkKit('#f4f6f8', '#d4af37', 'solid', '#f4f6f8', '#f4f6f8'),
    mkKit('#f97316', '#141414', 'solid', '#f97316', '#f97316'), '#38bdf8',
    [['Kylian Mbappe', 'ST', 92, 10, 'France'], ['Vinicius Junior', 'LW', 90, 7, 'Brazil'], ['Jude Bellingham', 'CAM', 90, 5, 'England'], ['Federico Valverde', 'CM', 88, 8, 'Uruguay'], ['Bernardo Silva', 'CM', 86, 20, 'Portugal'], ['Trent Alexander-Arnold', 'RB', 86, 12, 'England'], ['Ibrahima Konate', 'CB', 86, 16, 'France'], ['Dean Huijsen', 'CB', 84, 4, 'Spain'], ['Arda Guler', 'RW', 84, 15, 'Turkey'], ['Thibaut Courtois', 'GK', 88, 1, 'Belgium']]),
  mkClub('bar', 'esp', 'FC Barcelona', 'Barcelona', 'BAR', 88, 'Hansi Flick', 88, 'gegenpress',
    mkKit('#004d98', '#a50044', 'stripes', '#004d98', '#004d98'),
    mkKit('#141418', '#a50044', 'solid', '#141418', '#141418'), '#facc15',
    [['Lamine Yamal', 'RW', 90, 10, 'Spain'], ['Pedri', 'CM', 89, 8, 'Spain'], ['Rodri', 'CDM', 89, 16, 'Spain'], ['Raphinha', 'LW', 87, 11, 'Brazil'], ['Jules Kounde', 'RB', 86, 23, 'France'], ['Pau Cubarsi', 'CB', 85, 5, 'Spain'], ['Gabriel Jesus', 'ST', 84, 9, 'Brazil'], ['Alejandro Balde', 'LB', 84, 3, 'Spain'], ['Joan Garcia', 'GK', 84, 1, 'Spain']]),
  mkClub('atm', 'esp', 'Atletico Madrid', 'Atletico', 'ATM', 86, 'Diego Simeone', 88, 'low_block',
    mkKit('#cb3524', '#ffffff', 'stripes', '#1e3a8a', '#cb3524'),
    mkKit('#1e293b', '#38bdf8', 'solid', '#1e293b', '#1e293b'), '#22c55e',
    [['Julian Alvarez', 'ST', 88, 19, 'Argentina'], ['Ademola Lookman', 'LW', 85, 11, 'Nigeria'], ['Cristian Romero', 'CB', 85, 21, 'Argentina'], ['Alejandro Grimaldo', 'LB', 85, 22, 'Spain'], ['Jonathan David', 'ST', 84, 15, 'Canada'], ['Morten Hjulmand', 'CDM', 84, 23, 'Denmark'], ['Robin Le Normand', 'CB', 84, 24, 'Spain'], ['Jan Oblak', 'GK', 87, 13, 'Slovenia']]),
  mkClub('ath', 'esp', 'Athletic Club', 'Athletic', 'ATH', 82, 'Edin Terzic', 82, 'gegenpress',
    mkKit('#ee2523', '#ffffff', 'stripes', '#141414', '#141414'),
    mkKit('#1e3a8a', '#facc15', 'solid', '#1e3a8a', '#1e3a8a'), '#22c55e',
    [['Nico Williams', 'LW', 86, 10, 'Spain'], ['Oihan Sancet', 'CAM', 83, 8, 'Spain'], ['Dani Vivian', 'CB', 83, 3, 'Spain'], ['Aymeric Laporte', 'CB', 83, 14, 'Spain'], ['Inaki Williams', 'RW', 82, 9, 'Ghana'], ['Unai Simon', 'GK', 85, 1, 'Spain']]),
  mkClub('vil', 'esp', 'Villarreal', 'Villarreal', 'VIL', 81, 'Inigo Perez', 80, 'balanced',
    mkKit('#fde100', '#005187', 'solid', '#fde100', '#fde100'),
    mkKit('#7c1d3d', '#fde100', 'solid', '#7c1d3d', '#7c1d3d'), '#22c55e',
    [['Georges Mikautadze', 'ST', 81, 9, 'Georgia'], ['Alberto Moleiro', 'CAM', 81, 10, 'Spain'], ['Ayoze Perez', 'LW', 81, 22, 'Spain'], ['Renato Veiga', 'CB', 80, 4, 'Portugal'], ['Luiz Junior', 'GK', 79, 1, 'Brazil']]),
  mkClub('bet', 'esp', 'Real Betis', 'Real Betis', 'BET', 80, 'Manuel Pellegrini', 81, 'possession',
    mkKit('#0bb363', '#ffffff', 'stripes', '#ffffff', '#0bb363'),
    mkKit('#eab308', '#141414', 'solid', '#141414', '#eab308'), '#38bdf8',
    [['Isco', 'CAM', 83, 22, 'Spain'], ['Antony', 'RW', 82, 7, 'Brazil'], ['Giovani Lo Celso', 'CM', 82, 20, 'Argentina'], ['Cucho Hernandez', 'ST', 81, 9, 'Colombia'], ['Alvaro Valles', 'GK', 80, 1, 'Spain']]),
  mkClub('rso', 'esp', 'Real Sociedad', 'R. Sociedad', 'RSO', 80, 'Pellegrino Matarazzo', 79, 'possession',
    mkKit('#0067b1', '#ffffff', 'stripes', '#ffffff', '#0067b1'),
    mkKit('#1f2937', '#d4af37', 'solid', '#1f2937', '#1f2937'), '#facc15',
    [['Takefusa Kubo', 'RW', 82, 14, 'Japan'], ['Mikel Oyarzabal', 'ST', 82, 10, 'Spain'], ['Igor Zubeldia', 'CB', 80, 5, 'Spain'], ['Orri Oskarsson', 'ST', 79, 9, 'Iceland'], ['Alex Remiro', 'GK', 82, 1, 'Spain']]),
  mkClub('sev', 'esp', 'Sevilla FC', 'Sevilla', 'SEV', 78, 'Luis Garcia Plaza', 77, 'balanced',
    mkKit('#f4f6f8', '#d5001f', 'sleeves', '#f4f6f8', '#141414'),
    mkKit('#d5001f', '#ffffff', 'solid', '#d5001f', '#d5001f'), '#22c55e',
    [['Isaac Romero', 'ST', 78, 7, 'Spain'], ['Lucien Agoume', 'CDM', 78, 18, 'France'], ['Lucas Stassin', 'ST', 77, 9, 'Belgium'], ['Odysseas Vlachodimos', 'GK', 78, 1, 'Greece']]),
  mkClub('val', 'esp', 'Valencia CF', 'Valencia', 'VAL', 77, 'Javier Aguirre', 78, 'low_block',
    mkKit('#f4f6f8', '#141414', 'sleeves', '#141414', '#f4f6f8'),
    mkKit('#141416', '#f97316', 'solid', '#141416', '#141416'), '#facc15',
    [['Jose Gaya', 'LB', 80, 14, 'Spain'], ['Hugo Duro', 'ST', 79, 9, 'Spain'], ['Javi Guerra', 'CM', 79, 8, 'Spain'], ['Pepelu', 'CDM', 78, 18, 'Spain'], ['Stole Dimitrievski', 'GK', 77, 1, 'North Macedonia']]),
  mkClub('cel', 'esp', 'Celta Vigo', 'Celta Vigo', 'CEL', 77, 'Claudio Giraldez', 77, 'possession',
    mkKit('#8ac3ee', '#ffffff', 'solid', '#ffffff', '#8ac3ee'),
    mkKit('#1e293b', '#8ac3ee', 'sash', '#1e293b', '#1e293b'), '#facc15',
    [['Iago Aspas', 'ST', 80, 10, 'Spain'], ['Carl Starfelt', 'CB', 78, 2, 'Sweden'], ['Ilaix Moriba', 'CM', 78, 6, 'Guinea'], ['Ionut Radu', 'GK', 76, 1, 'Romania']]),
  mkClub('osa', 'esp', 'Osasuna', 'Osasuna', 'OSA', 76, 'Luis Miguel Ramis', 75, 'route_one',
    mkKit('#d91a21', '#0f204b', 'sleeves', '#0f204b', '#0f204b'),
    mkKit('#f4f6f8', '#d91a21', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Ante Budimir', 'ST', 80, 17, 'Croatia'], ['Aimar Oroz', 'CAM', 79, 10, 'Spain'], ['Sergio Herrera', 'GK', 78, 1, 'Spain']]),
  mkClub('epn', 'esp', 'Espanyol', 'Espanyol', 'EPN', 75, 'Eder Sarabia', 76, 'possession',
    mkKit('#007fc8', '#ffffff', 'stripes', '#007fc8', '#ffffff'),
    mkKit('#141416', '#f97316', 'solid', '#141416', '#141416'), '#facc15',
    [['Javi Puado', 'LW', 78, 7, 'Spain'], ['Leandro Cabrera', 'CB', 77, 6, 'Uruguay'], ['Marko Dmitrovic', 'GK', 76, 13, 'Serbia']]),
  mkClub('ray', 'esp', 'Rayo Vallecano', 'Rayo', 'RAY', 75, 'Benat San Jose', 75, 'gegenpress',
    mkKit('#f4f6f8', '#dc2626', 'sash', '#f4f6f8', '#f4f6f8'),
    mkKit('#141416', '#dc2626', 'sash', '#141416', '#141416'), '#22c55e',
    [['Isi Palazon', 'RW', 78, 7, 'Spain'], ['Florian Lejeune', 'CB', 77, 24, 'France'], ['Augusto Batalla', 'GK', 77, 13, 'Argentina']]),
  mkClub('get', 'esp', 'Getafe CF', 'Getafe', 'GET', 75, 'Jose Bordalas', 77, 'route_one',
    mkKit('#005999', '#ffffff', 'solid', '#005999', '#005999'),
    mkKit('#dc2626', '#ffffff', 'solid', '#dc2626', '#dc2626'), '#facc15',
    [['Borja Mayoral', 'ST', 78, 9, 'Spain'], ['Mauro Arambarri', 'CM', 78, 8, 'Uruguay'], ['Djene Dakonam', 'CB', 78, 2, 'Togo'], ['David Soria', 'GK', 79, 13, 'Spain']]),
  mkClub('ala', 'esp', 'Alaves', 'Alaves', 'ALA', 74, 'Quique Sanchez Flores', 75, 'low_block',
    mkKit('#00529f', '#ffffff', 'stripes', '#00529f', '#00529f'),
    mkKit('#141418', '#38bdf8', 'solid', '#141418', '#141418'), '#facc15',
    [['Toni Martinez', 'ST', 76, 11, 'Spain'], ['Ander Guevara', 'CM', 76, 6, 'Spain'], ['Antonio Sivera', 'GK', 77, 1, 'Spain']]),
  mkClub('elc', 'esp', 'Elche CF', 'Elche', 'ELC', 74, 'Martin Anselmi', 74, 'possession',
    mkKit('#f4f6f8', '#008c45', 'hoops', '#f4f6f8', '#f4f6f8'),
    mkKit('#006847', '#ffffff', 'solid', '#006847', '#006847'), '#facc15',
    [['Facundo Buonanotte', 'CAM', 77, 10, 'Argentina'], ['Thomas Lemar', 'CM', 77, 11, 'France'], ['Pedro Bigas', 'CB', 75, 6, 'Spain'], ['Matias Dituro', 'GK', 74, 1, 'Argentina']]),
  mkClub('dep', 'esp', 'Deportivo La Coruna', 'Deportivo', 'DEP', 74, 'Antonio Hidalgo', 74, 'gegenpress',
    mkKit('#00529f', '#ffffff', 'stripes', '#00529f', '#00529f'),
    mkKit('#141820', '#38bdf8', 'solid', '#141820', '#141820'), '#facc15',
    [['Jose Maria Gimenez', 'CB', 80, 2, 'Uruguay'], ['Marc Casado', 'CDM', 78, 6, 'Spain'], ['Yeremay Hernandez', 'LW', 77, 10, 'Spain'], ['Pierre-Emerick Aubameyang', 'ST', 77, 9, 'Gabon'], ['Leo Roman', 'GK', 75, 1, 'Spain']]),
  mkClub('lev2', 'esp', 'Levante UD', 'Levante', 'LEV2', 73, 'Luis Castro', 74, 'balanced',
    mkKit('#003f8a', '#a6192e', 'stripes', '#003f8a', '#003f8a'),
    mkKit('#f4f6f8', '#003f8a', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Ivan Romero', 'ST', 75, 9, 'Spain'], ['Aissa Mandi', 'CB', 75, 4, 'Algeria'], ['Carlos Brugue', 'LW', 74, 7, 'Spain'], ['Mathew Ryan', 'GK', 76, 1, 'Australia']]),
  mkClub('rac', 'esp', 'Racing Santander', 'Racing', 'RAC', 73, 'Jose Alberto Lopez', 74, 'possession',
    mkKit('#008c45', '#ffffff', 'solid', '#141414', '#008c45'),
    mkKit('#141416', '#22c55e', 'solid', '#141416', '#141416'), '#facc15',
    [['Sergio Canales', 'CM', 77, 8, 'Spain'], ['Inigo Vicente', 'CAM', 76, 10, 'Spain'], ['Yassir Zabiri', 'ST', 74, 9, 'Morocco'], ['Jokin Ezkieta', 'GK', 73, 1, 'Spain']]),
  mkClub('mal2', 'esp', 'Malaga CF', 'Malaga', 'MLG', 72, 'Juanfran Funes', 72, 'balanced',
    mkKit('#38bdf8', '#ffffff', 'stripes', '#ffffff', '#38bdf8'),
    mkKit('#1e1b4b', '#38bdf8', 'solid', '#1e1b4b', '#1e1b4b'), '#facc15',
    [['David Larrubia', 'RW', 74, 10, 'Spain'], ['Julen Lobete', 'LW', 73, 7, 'Spain'], ['Alfonso Herrero', 'GK', 74, 1, 'Spain']]),

  // ITALY — Serie A (20)
  mkClub('int', 'ita', 'Inter Milan', 'Inter', 'INT', 87, 'Cristian Chivu', 86, 'balanced',
    mkKit('#0068a8', '#141416', 'stripes', '#141416', '#141416'),
    mkKit('#f4f6f8', '#0068a8', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Lautaro Martinez', 'ST', 89, 10, 'Argentina'], ['Nicolo Barella', 'CM', 88, 23, 'Italy'], ['Alessandro Bastoni', 'CB', 88, 95, 'Italy'], ['Federico Dimarco', 'LB', 86, 32, 'Italy'], ['Hakan Calhanoglu', 'CDM', 85, 20, 'Turkey'], ['Marcus Thuram', 'ST', 85, 9, 'France'], ['Manuel Akanji', 'CB', 84, 25, 'Switzerland'], ['Ivan Provedel', 'GK', 82, 1, 'Italy']]),
  mkClub('nap', 'ita', 'Napoli', 'Napoli', 'NAP', 85, 'Massimiliano Allegri', 86, 'low_block',
    mkKit('#12a0d7', '#ffffff', 'solid', '#ffffff', '#12a0d7'),
    mkKit('#141820', '#12a0d7', 'solid', '#141820', '#141820'), '#facc15',
    [['Scott McTominay', 'CM', 86, 8, 'Scotland'], ['Kevin De Bruyne', 'CAM', 86, 11, 'Belgium'], ['Stanislav Lobotka', 'CDM', 84, 68, 'Slovakia'], ['Rasmus Hojlund', 'ST', 83, 19, 'Denmark'], ['Giovanni Di Lorenzo', 'RB', 83, 22, 'Italy'], ['Amir Rrahmani', 'CB', 83, 13, 'Kosovo'], ['Alex Meret', 'GK', 82, 1, 'Italy']]),
  mkClub('acm', 'ita', 'AC Milan', 'AC Milan', 'ACM', 84, 'Ruben Amorim', 83, 'gegenpress',
    mkKit('#fb090b', '#141414', 'stripes', '#141414', '#141414'),
    mkKit('#f4f6f8', '#fb090b', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Mike Maignan', 'GK', 88, 16, 'France'], ['Christian Pulisic', 'RW', 85, 11, 'USA'], ['Luka Modric', 'CM', 83, 14, 'Croatia'], ['Goncalo Ramos', 'ST', 83, 9, 'Portugal'], ['Strahinja Pavlovic', 'CB', 82, 31, 'Serbia'], ['Koni De Winter', 'CB', 80, 5, 'Belgium']]),
  mkClub('juv', 'ita', 'Juventus', 'Juventus', 'JUV', 84, 'Luciano Spalletti', 85, 'possession',
    mkKit('#f4f6f8', '#141414', 'stripes', '#141414', '#f4f6f8'),
    mkKit('#facc15', '#141414', 'solid', '#141414', '#facc15'), '#22c55e',
    [['Bremer', 'CB', 86, 3, 'Brazil'], ['Kenan Yildiz', 'LW', 84, 10, 'Turkey'], ['Randal Kolo Muani', 'ST', 83, 9, 'France'], ['Francisco Conceicao', 'RW', 83, 7, 'Portugal'], ['Edon Zhegrova', 'RW', 81, 11, 'Kosovo'], ['Nick Woltemade', 'ST', 81, 27, 'Germany'], ['Guglielmo Vicario', 'GK', 83, 25, 'Italy']]),
  mkClub('rom', 'ita', 'AS Roma', 'AS Roma', 'ROM', 83, 'Gian Piero Gasperini', 85, 'gegenpress',
    mkKit('#8e1f2f', '#f0bc42', 'solid', '#8e1f2f', '#8e1f2f'),
    mkKit('#f4f6f8', '#8e1f2f', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Paulo Dybala', 'CAM', 85, 21, 'Argentina'], ['Donyell Malen', 'ST', 84, 11, 'Netherlands'], ['Gianluca Mancini', 'CB', 82, 23, 'Italy'], ['Marten de Roon', 'CDM', 81, 15, 'Netherlands'], ['Mile Svilar', 'GK', 83, 99, 'Serbia']]),
  mkClub('ata', 'ita', 'Atalanta', 'Atalanta', 'ATA', 82, 'Maurizio Sarri', 82, 'possession',
    mkKit('#1e71b8', '#141416', 'stripes', '#141416', '#141416'),
    mkKit('#f4f6f8', '#1e71b8', 'sash', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Ederson Silva', 'CM', 84, 13, 'Brazil'], ['Charles De Ketelaere', 'CAM', 83, 17, 'Belgium'], ['Giorgio Scalvini', 'CB', 83, 42, 'Italy'], ['Nikola Krstovic', 'ST', 80, 9, 'Montenegro'], ['Marco Carnesecchi', 'GK', 83, 29, 'Italy']]),
  mkClub('laz', 'ita', 'Lazio', 'Lazio', 'LAZ', 80, 'Gennaro Gattuso', 79, 'route_one',
    mkKit('#87d8f7', '#ffffff', 'solid', '#ffffff', '#87d8f7'),
    mkKit('#141c2e', '#87d8f7', 'solid', '#141c2e', '#141c2e'), '#facc15',
    [['Mattia Zaccagni', 'LW', 83, 10, 'Italy'], ['Davide Frattesi', 'CM', 82, 16, 'Italy'], ['Tijjani Noslin', 'ST', 79, 14, 'Netherlands'], ['Gustav Isaksen', 'RW', 79, 18, 'Denmark'], ['Christos Mandas', 'GK', 78, 35, 'Greece']]),
  mkClub('bol', 'ita', 'Bologna', 'Bologna', 'BOL', 79, 'Raffaele Palladino', 80, 'balanced',
    mkKit('#a21c26', '#1a2f48', 'stripes', '#ffffff', '#1a2f48'),
    mkKit('#f4f6f8', '#a21c26', 'hoops', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Riccardo Orsolini', 'RW', 82, 7, 'Italy'], ['Lewis Ferguson', 'CM', 81, 19, 'Scotland'], ['Santiago Castro', 'ST', 79, 9, 'Argentina'], ['Lukasz Skorupski', 'GK', 79, 1, 'Poland']]),
  mkClub('fio', 'ita', 'Fiorentina', 'Fiorentina', 'FIO', 79, 'Paolo Vanoli', 78, 'balanced',
    mkKit('#482e92', '#ffffff', 'solid', '#482e92', '#482e92'),
    mkKit('#f4f6f8', '#482e92', 'sash', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Moise Kean', 'ST', 81, 20, 'Italy'], ['Franco Mastantuono', 'CAM', 80, 10, 'Argentina'], ['Mateo Pellegrino', 'ST', 78, 9, 'Argentina'], ['David De Gea', 'GK', 82, 43, 'Spain']]),
  mkClub('com', 'ita', 'Como 1907', 'Como', 'COM', 78, 'Cesc Fabregas', 79, 'possession',
    mkKit('#00529f', '#ffffff', 'solid', '#00529f', '#00529f'),
    mkKit('#f4f6f8', '#00529f', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Nico Paz', 'CAM', 82, 10, 'Argentina'], ['Anastasios Douvikas', 'ST', 77, 9, 'Greece'], ['Jean Butez', 'GK', 78, 1, 'France']]),
  mkClub('tor', 'ita', 'Torino', 'Torino', 'TOR', 76, 'Roberto D-Aversa', 76, 'low_block',
    mkKit('#8a1e03', '#ffffff', 'solid', '#ffffff', '#141414'),
    mkKit('#f4f6f8', '#8a1e03', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Che Adams', 'ST', 78, 18, 'Scotland'], ['Nikola Vlasic', 'CAM', 78, 10, 'Croatia'], ['Alberto Paleari', 'GK', 75, 1, 'Italy']]),
  mkClub('udi', 'ita', 'Udinese', 'Udinese', 'UDI', 75, 'Paolo Zanetti', 75, 'route_one',
    mkKit('#f4f6f8', '#141414', 'stripes', '#141414', '#141414'),
    mkKit('#facc15', '#141414', 'solid', '#141414', '#facc15'), '#22c55e',
    [['Lorenzo Lucca', 'ST', 78, 17, 'Italy'], ['Arthur Atta', 'CM', 76, 14, 'France'], ['Maduka Okoye', 'GK', 76, 40, 'Nigeria']]),
  mkClub('gen', 'ita', 'Genoa', 'Genoa', 'GEN', 75, 'Daniele De Rossi', 76, 'balanced',
    mkKit('#a6192e', '#00205b', 'stripes', '#00205b', '#00205b'),
    mkKit('#f4f6f8', '#a6192e', 'hoops', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Morten Frendrup', 'CM', 78, 32, 'Denmark'], ['Lorenzo Colombo', 'ST', 76, 9, 'Italy'], ['Nicola Leali', 'GK', 75, 1, 'Italy']]),
  mkClub('cag', 'ita', 'Cagliari', 'Cagliari', 'CAG', 74, 'Fabio Pisacane', 74, 'low_block',
    mkKit('#a21c26', '#002350', 'stripes', '#002350', '#002350'),
    mkKit('#f4f6f8', '#a21c26', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Sebastiano Esposito', 'ST', 76, 9, 'Italy'], ['Yerry Mina', 'CB', 76, 26, 'Colombia'], ['Elia Caprile', 'GK', 77, 1, 'Italy']]),
  mkClub('par', 'ita', 'Parma', 'Parma', 'PAR', 74, 'Alberto Gilardino', 74, 'balanced',
    mkKit('#f4f6f8', '#141414', 'hoops', '#141414', '#f4f6f8'),
    mkKit('#facc15', '#1d4ed8', 'hoops', '#1d4ed8', '#facc15'), '#22c55e',
    [['Adrian Bernabe', 'CM', 77, 10, 'Spain'], ['Ange-Yoan Bonny', 'ST', 76, 13, 'France'], ['Zion Suzuki', 'GK', 77, 31, 'Japan']]),
  mkClub('lec', 'ita', 'Lecce', 'Lecce', 'LEC', 73, 'Eusebio Di Francesco', 73, 'gegenpress',
    mkKit('#fde100', '#e30613', 'stripes', '#e30613', '#e30613'),
    mkKit('#f4f6f8', '#e30613', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Francesco Camarda', 'ST', 74, 22, 'Italy'], ['Wladimiro Falcone', 'GK', 77, 30, 'Italy']]),
  mkClub('sas', 'ita', 'Sassuolo', 'Sassuolo', 'SAS', 74, 'Alberto Aquilani', 74, 'possession',
    mkKit('#00a651', '#141414', 'stripes', '#141414', '#00a651'),
    mkKit('#f4f6f8', '#00a651', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Domenico Berardi', 'RW', 79, 10, 'Italy'], ['Kristian Thorstvedt', 'CM', 77, 42, 'Norway'], ['Vasilije Adzic', 'CAM', 75, 17, 'Montenegro'], ['Arijanet Muric', 'GK', 75, 1, 'Kosovo']]),
  mkClub('mon', 'ita', 'Monza', 'Monza', 'MON', 73, 'Ivan Juric', 74, 'gegenpress',
    mkKit('#e30613', '#ffffff', 'sash', '#e30613', '#e30613'),
    mkKit('#f4f6f8', '#e30613', 'sash', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Gustavo Varela', 'ST', 76, 9, 'Uruguay'], ['Matteo Pessina', 'CM', 77, 32, 'Italy'], ['Stefano Turati', 'GK', 75, 30, 'Italy']]),
  mkClub('fro', 'ita', 'Frosinone', 'Frosinone', 'FRO', 73, 'Massimiliano Alvini', 73, 'gegenpress',
    mkKit('#fde100', '#1d4ed8', 'solid', '#1d4ed8', '#fde100'),
    mkKit('#1d4ed8', '#fde100', 'solid', '#1d4ed8', '#1d4ed8'), '#22c55e',
    [['Antonio Raimondo', 'ST', 75, 9, 'Italy'], ['Giacomo Calo', 'CM', 75, 8, 'Italy'], ['Michele Cerofolini', 'GK', 73, 1, 'Italy']]),
  mkClub('ven', 'ita', 'Venezia', 'Venezia', 'VEN', 72, 'Davide Nicola', 73, 'low_block',
    mkKit('#141416', '#f97316', 'hoops', '#141416', '#141416'),
    mkKit('#f4f6f8', '#16a34a', 'sash', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Andrea Adorante', 'ST', 74, 9, 'Italy'], ['Hans Nicolussi Caviglia', 'CDM', 75, 14, 'Italy'], ['Filip Stankovic', 'GK', 75, 35, 'Serbia']]),

  // GERMANY — Bundesliga (18)
  mkClub('fcb', 'ger', 'Bayern Munich', 'Bayern', 'FCB', 89, 'Vincent Kompany', 88, 'possession',
    mkKit('#dc052d', '#ffffff', 'solid', '#dc052d', '#dc052d'),
    mkKit('#141418', '#38bdf8', 'solid', '#141418', '#141418'), '#facc15',
    [['Harry Kane', 'ST', 91, 9, 'England'], ['Jamal Musiala', 'CAM', 89, 42, 'Germany'], ['Michael Olise', 'RW', 88, 17, 'France'], ['Joshua Kimmich', 'CDM', 88, 6, 'Germany'], ['Luis Diaz', 'LW', 86, 14, 'Colombia'], ['Dayot Upamecano', 'CB', 86, 2, 'France'], ['Alphonso Davies', 'LB', 85, 19, 'Canada'], ['Jonathan Tah', 'CB', 85, 4, 'Germany'], ['Manuel Neuer', 'GK', 85, 1, 'Germany']]),
  mkClub('bvb', 'ger', 'Borussia Dortmund', 'Dortmund', 'BVB', 83, 'Niko Kovac', 83, 'gegenpress',
    mkKit('#fde100', '#141414', 'sleeves', '#141414', '#fde100'),
    mkKit('#141416', '#fde100', 'solid', '#141416', '#141416'), '#22c55e',
    [['Serhou Guirassy', 'ST', 86, 9, 'Guinea'], ['Nico Schlotterbeck', 'CB', 85, 4, 'Germany'], ['Felix Nmecha', 'CM', 82, 8, 'Germany'], ['Maximilian Beier', 'ST', 81, 14, 'Germany'], ['Jobe Bellingham', 'CM', 80, 7, 'England'], ['Gregor Kobel', 'GK', 87, 1, 'Switzerland']]),
  mkClub('lev', 'ger', 'Bayer Leverkusen', 'Leverkusen', 'LEV', 83, 'Carles Martinez', 81, 'possession',
    mkKit('#e32221', '#141414', 'sash', '#141414', '#141414'),
    mkKit('#f4f6f8', '#e32221', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Patrik Schick', 'ST', 83, 14, 'Czech Republic'], ['Edmond Tapsoba', 'CB', 83, 12, 'Burkina Faso'], ['Miguel Gutierrez', 'LB', 82, 3, 'Spain'], ['Aleix Garcia', 'CM', 82, 24, 'Spain'], ['Malik Tillman', 'CAM', 81, 10, 'USA'], ['Jarell Quansah', 'CB', 80, 4, 'England'], ['Mark Flekken', 'GK', 81, 1, 'Netherlands']]),
  mkClub('rbl', 'ger', 'RB Leipzig', 'Leipzig', 'RBL', 82, 'Martin Demichelis', 81, 'gegenpress',
    mkKit('#f4f6f8', '#dd0741', 'sleeves', '#dd0741', '#f4f6f8'),
    mkKit('#141c2e', '#dd0741', 'solid', '#141c2e', '#141c2e'), '#facc15',
    [['Antonio Nusa', 'LW', 82, 7, 'Norway'], ['Willi Orban', 'CB', 82, 4, 'Hungary'], ['Johan Bakayoko', 'RW', 81, 11, 'Belgium'], ['Brajan Gruda', 'CAM', 80, 10, 'Germany'], ['Assan Ouedraogo', 'CM', 79, 14, 'Germany'], ['Orjan Nyland', 'GK', 78, 1, 'Norway']]),
  mkClub('stu', 'ger', 'VfB Stuttgart', 'Stuttgart', 'STU', 81, 'Sebastian Hoeness', 83, 'possession',
    mkKit('#f4f6f8', '#e32221', 'hoops', '#f4f6f8', '#f4f6f8'),
    mkKit('#dc2626', '#141414', 'hoops', '#141414', '#dc2626'), '#22c55e',
    [['Ermedin Demirovic', 'ST', 82, 9, 'Bosnia'], ['Maximilian Mittelstadt', 'LB', 81, 7, 'Germany'], ['Chris Fuhrich', 'LW', 80, 27, 'Germany'], ['Jeff Chabot', 'CB', 80, 24, 'Germany'], ['Atakan Karazor', 'CDM', 79, 16, 'Turkey'], ['Fabian Bredlow', 'GK', 77, 1, 'Germany']]),
  mkClub('sge', 'ger', 'Eintracht Frankfurt', 'Frankfurt', 'SGE', 80, 'Albert Riera', 80, 'possession',
    mkKit('#e1000f', '#141414', 'stripes', '#141414', '#141414'),
    mkKit('#f4f6f8', '#141414', 'solid', '#141414', '#f4f6f8'), '#facc15',
    [['Jonathan Burkardt', 'ST', 82, 9, 'Germany'], ['Robin Koch', 'CB', 81, 4, 'Germany'], ['Mario Gotze', 'CAM', 79, 27, 'Germany'], ['Noah Atubolu', 'GK', 80, 1, 'Germany']]),
  mkClub('tsg', 'ger', 'TSG Hoffenheim', 'Hoffenheim', 'TSG', 78, 'Christian Ilzer', 78, 'gegenpress',
    mkKit('#1961b5', '#ffffff', 'solid', '#1961b5', '#1961b5'),
    mkKit('#f4f6f8', '#1961b5', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Andrej Kramaric', 'CAM', 80, 27, 'Croatia'], ['Fisnik Asllani', 'ST', 78, 11, 'Kosovo'], ['Oliver Baumann', 'GK', 81, 1, 'Germany']]),
  mkClub('scf', 'ger', 'SC Freiburg', 'Freiburg', 'SCF', 77, 'Julian Schuster', 78, 'balanced',
    mkKit('#e30613', '#141414', 'solid', '#141414', '#e30613'),
    mkKit('#f4f6f8', '#e30613', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Vincenzo Grifo', 'LW', 79, 32, 'Italy'], ['Matthias Ginter', 'CB', 79, 28, 'Germany'], ['Florian Muller', 'GK', 76, 1, 'Germany']]),
  mkClub('m05', 'ger', 'Mainz 05', 'Mainz 05', 'M05', 76, 'Urs Fischer', 77, 'low_block',
    mkKit('#c3141e', '#ffffff', 'sleeves', '#ffffff', '#c3141e'),
    mkKit('#141418', '#c3141e', 'solid', '#141418', '#141418'), '#22c55e',
    [['Nadiem Amiri', 'CM', 79, 18, 'Germany'], ['Lee Jae-sung', 'CAM', 77, 7, 'South Korea'], ['Robin Zentner', 'GK', 78, 27, 'Germany']]),
  mkClub('bmg', 'ger', 'Borussia Monchengladbach', 'Gladbach', 'BMG', 76, 'Eugen Polanski', 76, 'balanced',
    mkKit('#f4f6f8', '#141414', 'stripes', '#f4f6f8', '#f4f6f8'),
    mkKit('#16a34a', '#141414', 'solid', '#141414', '#16a34a'), '#facc15',
    [['Tim Kleindienst', 'ST', 79, 11, 'Germany'], ['Rocco Reitz', 'CM', 77, 27, 'Germany'], ['Moritz Nicolas', 'GK', 77, 33, 'Germany']]),
  mkClub('svw', 'ger', 'Werder Bremen', 'W. Bremen', 'SVW', 76, 'Daniel Thioune', 76, 'balanced',
    mkKit('#1d9053', '#ffffff', 'solid', '#ffffff', '#1d9053'),
    mkKit('#141418', '#1d9053', 'solid', '#141418', '#141418'), '#facc15',
    [['Romano Schmid', 'CAM', 78, 20, 'Austria'], ['Jens Stage', 'CM', 78, 6, 'Denmark'], ['Mio Backhaus', 'GK', 75, 30, 'Germany']]),
  mkClub('fcu', 'ger', 'Union Berlin', 'Union Berlin', 'FCU', 75, 'Marie-Louise Eta', 75, 'low_block',
    mkKit('#d4011d', '#ffffff', 'solid', '#d4011d', '#d4011d'),
    mkKit('#1e293b', '#d4011d', 'solid', '#1e293b', '#1e293b'), '#22c55e',
    [['Ilyas Ansah', 'ST', 76, 10, 'Germany'], ['Rani Khedira', 'CDM', 76, 8, 'Germany'], ['Frederik Ronnow', 'GK', 79, 1, 'Denmark']]),
  mkClub('fca', 'ger', 'FC Augsburg', 'Augsburg', 'FCA', 75, 'Manuel Baum', 75, 'low_block',
    mkKit('#f4f6f8', '#ba3733', 'solid', '#f4f6f8', '#f4f6f8'),
    mkKit('#14532d', '#f4f6f8', 'solid', '#14532d', '#14532d'), '#facc15',
    [['Alexis Claude-Maurice', 'CAM', 77, 19, 'France'], ['Jeffrey Gouweleeuw', 'CB', 76, 6, 'Netherlands'], ['Finn Dahmen', 'GK', 77, 1, 'Germany']]),
  mkClub('kol', 'ger', '1. FC Koln', 'FC Koln', 'KOL', 75, 'Rene Wagner', 75, 'gegenpress',
    mkKit('#f4f6f8', '#e30613', 'sleeves', '#f4f6f8', '#f4f6f8'),
    mkKit('#dc2626', '#141414', 'solid', '#dc2626', '#dc2626'), '#22c55e',
    [['Ellyes Skhiri', 'CDM', 78, 28, 'Tunisia'], ['Borna Sosa', 'LB', 77, 3, 'Croatia'], ['Ragnar Ache', 'ST', 76, 9, 'Germany'], ['Said El Mala', 'LW', 76, 13, 'Germany'], ['Marvin Schwabe', 'GK', 77, 1, 'Germany']]),
  mkClub('hsv', 'ger', 'Hamburger SV', 'Hamburg', 'HSV', 75, 'Merlin Polzin', 75, 'possession',
    mkKit('#f4f6f8', '#005b9c', 'solid', '#dc2626', '#005b9c'),
    mkKit('#005b9c', '#ffffff', 'solid', '#005b9c', '#005b9c'), '#facc15',
    [['David Wolfe', 'LB', 76, 3, 'Norway'], ['Miro Muheim', 'LB', 76, 28, 'Switzerland'], ['Ransford Konigsdorffer', 'ST', 75, 11, 'Ghana'], ['Daniel Heuer Fernandes', 'GK', 76, 1, 'Portugal']]),
  mkClub('s04', 'ger', 'FC Schalke 04', 'Schalke 04', 'S04', 75, 'Miron Muslic', 75, 'gegenpress',
    mkKit('#004b93', '#ffffff', 'solid', '#ffffff', '#004b93'),
    mkKit('#f4f6f8', '#004b93', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Edin Dzeko', 'ST', 78, 10, 'Bosnia'], ['Hwang Hee-chan', 'LW', 78, 11, 'South Korea'], ['Robin Gosens', 'LB', 78, 8, 'Germany'], ['Kenan Karaman', 'CAM', 76, 19, 'Turkey'], ['Loris Karius', 'GK', 75, 1, 'Germany']]),
  mkClub('elv', 'ger', 'SV Elversberg', 'Elversberg', 'ELV', 73, 'Horst Steffen', 74, 'possession',
    mkKit('#f4f6f8', '#141414', 'sash', '#141414', '#f4f6f8'),
    mkKit('#141416', '#38bdf8', 'solid', '#141416', '#141416'), '#22c55e',
    [['Maurice Krattenmacher', 'CAM', 74, 10, 'Germany'], ['Noah Darvich', 'CAM', 74, 14, 'Germany'], ['Noel Futkeu', 'ST', 74, 9, 'Germany'], ['Nicolas Kristof', 'GK', 74, 1, 'Germany']]),
  mkClub('pad', 'ger', 'SC Paderborn 07', 'Paderborn', 'PAD', 73, 'Lukas Kwasniok', 74, 'gegenpress',
    mkKit('#00529f', '#141414', 'stripes', '#141414', '#00529f'),
    mkKit('#f4f6f8', '#00529f', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Marvin Pieringer', 'ST', 74, 9, 'Germany'], ['Santiago Castaneda', 'CDM', 74, 6, 'USA'], ['Raphael Obermair', 'RW', 74, 23, 'Germany'], ['Nahuel Noll', 'GK', 74, 1, 'Germany']]),

  // FRANCE — Ligue 1 (18)
  mkClub('psg', 'fra', 'Paris Saint-Germain', 'PSG', 'PSG', 88, 'Luis Enrique', 89, 'possession',
    mkKit('#004170', '#da291c', 'sash', '#004170', '#004170'),
    mkKit('#f4f6f8', '#004170', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Ousmane Dembele', 'RW', 89, 10, 'France'], ['Vitinha', 'CM', 88, 17, 'Portugal'], ['Achraf Hakimi', 'RB', 87, 2, 'Morocco'], ['Joao Neves', 'CM', 86, 87, 'Portugal'], ['Nuno Mendes', 'LB', 86, 25, 'Portugal'], ['Desire Doue', 'CAM', 85, 14, 'France'], ['Bradley Barcola', 'LW', 85, 29, 'France'], ['Marquinhos', 'CB', 85, 5, 'Brazil'], ['Ferran Torres', 'ST', 83, 11, 'Spain'], ['Matvey Safonov', 'GK', 82, 39, 'Russia']]),
  mkClub('om', 'fra', 'Olympique Marseille', 'Marseille', 'OM', 82, 'Bruno Genesio', 82, 'balanced',
    mkKit('#f4f6f8', '#2faee0', 'sleeves', '#f4f6f8', '#f4f6f8'),
    mkKit('#0c1e3a', '#2faee0', 'solid', '#0c1e3a', '#0c1e3a'), '#facc15',
    [['Mason Greenwood', 'RW', 84, 10, 'England'], ['Pierre-Emile Hojbjerg', 'CDM', 82, 23, 'Denmark'], ['Amine Gouiri', 'ST', 81, 9, 'Algeria'], ['Nayef Aguerd', 'CB', 81, 5, 'Morocco'], ['Geronimo Rulli', 'GK', 80, 1, 'Argentina']]),
  mkClub('mona', 'fra', 'AS Monaco', 'Monaco', 'ASM', 81, 'Filipe Luis', 81, 'gegenpress',
    mkKit('#e51a22', '#ffffff', 'sash', '#ffffff', '#e51a22'),
    mkKit('#141c24', '#d4af37', 'solid', '#141c24', '#141c24'), '#22c55e',
    [['Maghnes Akliouche', 'RW', 82, 11, 'France'], ['Denis Zakaria', 'CDM', 82, 6, 'Switzerland'], ['Folarin Balogun', 'ST', 80, 9, 'USA'], ['Lukas Hradecky', 'GK', 81, 1, 'Finland']]),
  mkClub('ol', 'fra', 'Olympique Lyon', 'Lyon', 'OL', 80, 'Jorge Maciel', 79, 'possession',
    mkKit('#f4f6f8', '#14387f', 'sash', '#f4f6f8', '#f4f6f8'),
    mkKit('#14141a', '#e30613', 'solid', '#14141a', '#14141a'), '#22c55e',
    [['Corentin Tolisso', 'CM', 80, 8, 'France'], ['Pavel Sulc', 'CAM', 80, 10, 'Czech Republic'], ['Moussa Niakhate', 'CB', 80, 19, 'Senegal'], ['Dominik Greif', 'GK', 79, 1, 'Slovakia']]),
  mkClub('lil', 'fra', 'Lille OSC', 'Lille', 'LIL', 80, 'Davide Ancelotti', 79, 'balanced',
    mkKit('#e01e13', '#12224d', 'solid', '#12224d', '#e01e13'),
    mkKit('#f4f6f8', '#e01e13', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Alexsandro', 'CB', 81, 4, 'Brazil'], ['Benjamin Andre', 'CDM', 80, 21, 'France'], ['Ethan Mbappe', 'RW', 78, 29, 'France'], ['Berke Ozer', 'GK', 78, 1, 'Turkey']]),
  mkClub('len', 'fra', 'RC Lens', 'RC Lens', 'LEN', 79, 'Yannick Cahuzac', 78, 'gegenpress',
    mkKit('#ec1c24', '#fde100', 'stripes', '#141414', '#ec1c24'),
    mkKit('#141416', '#fde100', 'solid', '#141416', '#141416'), '#22c55e',
    [['Florian Thauvin', 'RW', 79, 10, 'France'], ['Michael Cuisance', 'CM', 77, 8, 'France'], ['Robin Risser', 'GK', 78, 1, 'France']]),
  mkClub('str', 'fra', 'RC Strasbourg', 'Strasbourg', 'STR', 78, 'Vitor Matos', 77, 'possession',
    mkKit('#0072bb', '#ffffff', 'solid', '#ffffff', '#0072bb'),
    mkKit('#f4f6f8', '#0072bb', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Giovanni Reyna', 'CAM', 79, 10, 'USA'], ['Pape Diop', 'CM', 77, 8, 'Senegal'], ['Mike Penders', 'GK', 77, 1, 'Belgium']]),
  mkClub('nic', 'fra', 'OGC Nice', 'Nice', 'NIC', 78, 'Olivier Pantaloni', 77, 'balanced',
    mkKit('#cc1122', '#141414', 'stripes', '#141414', '#141414'),
    mkKit('#f4f6f8', '#cc1122', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Jonathan Clauss', 'RB', 79, 92, 'France'], ['Sofiane Diop', 'CAM', 78, 10, 'Morocco'], ['Yehvann Diouf', 'GK', 78, 1, 'France']]),
  mkClub('ren', 'fra', 'Stade Rennais', 'Rennes', 'REN', 77, 'Habib Beye', 77, 'balanced',
    mkKit('#dc141b', '#141414', 'sleeves', '#141414', '#141414'),
    mkKit('#f4f6f8', '#dc141b', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Abdelhamid Ait Boudlal', 'CB', 77, 4, 'Morocco'], ['Seko Fofana', 'CM', 79, 8, 'Ivory Coast'], ['Brice Samba', 'GK', 80, 30, 'France']]),
  mkClub('pfc', 'fra', 'Paris FC', 'Paris FC', 'PFC', 76, 'Liam Rosenior', 78, 'possession',
    mkKit('#1d3557', '#e63946', 'solid', '#1d3557', '#1d3557'),
    mkKit('#f4f6f8', '#1d3557', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Maxime Lopez', 'CM', 78, 8, 'France'], ['Jean-Philippe Krasso', 'ST', 76, 17, 'Ivory Coast'], ['Kevin Trapp', 'GK', 79, 1, 'Germany']]),
  mkClub('bre2', 'fra', 'Stade Brestois', 'Brest', 'BRS', 75, 'Eric Roy', 77, 'route_one',
    mkKit('#e30613', '#ffffff', 'solid', '#ffffff', '#e30613'),
    mkKit('#f4f6f8', '#141414', 'solid', '#141414', '#f4f6f8'), '#22c55e',
    [['Kenny Lala', 'RB', 76, 7, 'France'], ['Ludovic Ajorque', 'ST', 77, 19, 'France'], ['Gregoire Coudert', 'GK', 74, 30, 'France']]),
  mkClub('tou', 'fra', 'Toulouse FC', 'Toulouse', 'TOU', 75, 'Jens Berthel Askou', 75, 'balanced',
    mkKit('#5a2d82', '#ffffff', 'stripes', '#5a2d82', '#5a2d82'),
    mkKit('#f4f6f8', '#5a2d82', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Yann Gboho', 'LW', 77, 10, 'France'], ['Guillaume Restes', 'GK', 78, 50, 'France']]),
  mkClub('lor', 'fra', 'FC Lorient', 'Lorient', 'LOR', 74, 'Alexandre Dujeux', 75, 'balanced',
    mkKit('#f97316', '#141414', 'solid', '#141414', '#f97316'),
    mkKit('#f4f6f8', '#f97316', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Jean-Victor Makengo', 'CM', 75, 17, 'France'], ['Yvon Mvogo', 'GK', 76, 38, 'Switzerland']]),
  mkClub('aux', 'fra', 'AJ Auxerre', 'Auxerre', 'AUX', 73, 'Will Still', 76, 'gegenpress',
    mkKit('#f4f6f8', '#0055a4', 'solid', '#f4f6f8', '#f4f6f8'),
    mkKit('#0055a4', '#ffffff', 'solid', '#0055a4', '#0055a4'), '#facc15',
    [['Lassine Sinayoko', 'ST', 75, 10, 'Mali'], ['Donovan Leon', 'GK', 75, 16, 'French Guiana']]),
  mkClub('ang', 'fra', 'Angers SCO', 'Angers', 'ANG', 72, 'Christophe Pelissier', 73, 'low_block',
    mkKit('#141414', '#ffffff', 'stripes', '#141414', '#141414'),
    mkKit('#f4f6f8', '#141414', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Esteban Lepaul', 'ST', 74, 9, 'France'], ['Herve Koffi', 'GK', 74, 1, 'Burkina Faso']]),
  mkClub('leh', 'fra', 'Le Havre AC', 'Le Havre', 'HAC', 72, 'Didier Digard', 72, 'route_one',
    mkKit('#002855', '#5eb6e4', 'solid', '#002855', '#5eb6e4'),
    mkKit('#f4f6f8', '#002855', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Abdoulaye Toure', 'CDM', 74, 94, 'Guinea'], ['Mory Diaw', 'GK', 74, 1, 'Senegal']]),
  mkClub('tro', 'fra', 'ESTAC Troyes', 'Troyes', 'TRO', 71, 'Stephane Dumont', 72, 'balanced',
    mkKit('#0055a4', '#ffffff', 'solid', '#0055a4', '#0055a4'),
    mkKit('#f4f6f8', '#0055a4', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Junior Diaz', 'CB', 73, 4, 'Ivory Coast'], ['Nicolas Lemaitre', 'GK', 72, 1, 'France']]),
  mkClub('lem', 'fra', 'Le Mans FC', 'Le Mans', 'LMN', 71, 'Patrick Videira', 72, 'low_block',
    mkKit('#e30613', '#facc15', 'solid', '#e30613', '#e30613'),
    mkKit('#f4f6f8', '#e30613', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Louis Mafouta', 'ST', 73, 9, 'CAR'], ['Lucas Bretelle', 'CM', 72, 8, 'France'], ['Samuel Yohou', 'CB', 72, 5, 'Ivory Coast']]),
];

// ---------------------------------------------------------------------------
// 32 National Teams
// ---------------------------------------------------------------------------
function mkNation(id, name, abbr, confed, rating, mgrName, mgrRating, style, homeKit, awayKit, gkColor, stars) {
  return {
    id, leagueId: 'intl', type: 'nation', country: name, confed, name, short: name, abbr, rating,
    manager: { name: mgrName, tacticalRating: mgrRating, style },
    homeKit, awayKit,
    gkKit: mkKit(gkColor, '#14171f', 'solid', '#14171f', gkColor),
    stars,
  };
}

export const NATIONAL_TEAMS = [
  mkNation('nat_esp', 'Spain', 'ESP', 'UEFA', 90, 'Luis de la Fuente', 90, 'possession',
    mkKit('#aa151b', '#f1bf00', 'solid', '#1e3a8a', '#aa151b'),
    mkKit('#facc15', '#38bdf8', 'solid', '#1e3a8a', '#facc15'), '#22c55e',
    [['Lamine Yamal', 'RW', 90, 19, 'Spain'], ['Rodri', 'CDM', 89, 16, 'Spain'], ['Pedri', 'CM', 89, 20, 'Spain'], ['Nico Williams', 'LW', 86, 11, 'Spain'], ['Unai Simon', 'GK', 85, 23, 'Spain']]),
  mkNation('nat_fra', 'France', 'FRA', 'UEFA', 89, 'Zinedine Zidane', 89, 'balanced',
    mkKit('#002654', '#ffffff', 'solid', '#ffffff', '#ef4444'),
    mkKit('#f4f6f8', '#002654', 'stripes', '#002654', '#f4f6f8'), '#facc15',
    [['Kylian Mbappe', 'ST', 92, 10, 'France'], ['Ousmane Dembele', 'RW', 89, 11, 'France'], ['Michael Olise', 'RW', 88, 7, 'France'], ['William Saliba', 'CB', 88, 17, 'France'], ['Mike Maignan', 'GK', 88, 16, 'France']]),
  mkNation('nat_arg', 'Argentina', 'ARG', 'CONMEBOL', 88, 'Lionel Scaloni', 89, 'possession',
    mkKit('#75aadb', '#ffffff', 'stripes', '#141414', '#ffffff'),
    mkKit('#1a237e', '#75aadb', 'solid', '#1a237e', '#1a237e'), '#22c55e',
    [['Lionel Messi', 'RW', 88, 10, 'Argentina'], ['Lautaro Martinez', 'ST', 89, 22, 'Argentina'], ['Julian Alvarez', 'ST', 88, 9, 'Argentina'], ['Alexis Mac Allister', 'CM', 86, 20, 'Argentina'], ['Emiliano Martinez', 'GK', 86, 23, 'Argentina']]),
  mkNation('nat_eng', 'England', 'ENG', 'UEFA', 88, 'Thomas Tuchel', 88, 'balanced',
    mkKit('#f4f6f8', '#0a1f44', 'solid', '#0a1f44', '#f4f6f8'),
    mkKit('#4b1c3c', '#f4cd72', 'solid', '#4b1c3c', '#4b1c3c'), '#22c55e',
    [['Harry Kane', 'ST', 91, 9, 'England'], ['Jude Bellingham', 'CAM', 90, 10, 'England'], ['Bukayo Saka', 'RW', 88, 7, 'England'], ['Declan Rice', 'CDM', 88, 4, 'England'], ['Jordan Pickford', 'GK', 83, 1, 'England']]),
  mkNation('nat_bra', 'Brazil', 'BRA', 'CONMEBOL', 87, 'Carlo Ancelotti', 90, 'balanced',
    mkKit('#ffdf00', '#009c3b', 'solid', '#002776', '#ffffff'),
    mkKit('#002776', '#ffdf00', 'solid', '#ffffff', '#002776'), '#141416',
    [['Vinicius Junior', 'LW', 90, 7, 'Brazil'], ['Raphinha', 'RW', 87, 11, 'Brazil'], ['Gabriel Magalhaes', 'CB', 87, 6, 'Brazil'], ['Bruno Guimaraes', 'CM', 85, 5, 'Brazil'], ['Alisson Becker', 'GK', 88, 1, 'Brazil']]),
  mkNation('nat_ger', 'Germany', 'GER', 'UEFA', 86, 'Julian Nagelsmann', 86, 'gegenpress',
    mkKit('#f4f6f8', '#141414', 'sleeves', '#141414', '#f4f6f8'),
    mkKit('#db2777', '#4c1d95', 'hoops', '#4c1d95', '#db2777'), '#facc15',
    [['Florian Wirtz', 'CAM', 89, 17, 'Germany'], ['Jamal Musiala', 'CAM', 89, 10, 'Germany'], ['Joshua Kimmich', 'CDM', 88, 6, 'Germany'], ['Nico Schlotterbeck', 'CB', 85, 15, 'Germany'], ['Oliver Baumann', 'GK', 81, 1, 'Germany']]),
  mkNation('nat_por', 'Portugal', 'POR', 'UEFA', 86, 'Roberto Martinez', 84, 'possession',
    mkKit('#cc1122', '#006600', 'solid', '#006600', '#cc1122'),
    mkKit('#f4f6f8', '#1e3a8a', 'solid', '#1e3a8a', '#f4f6f8'), '#facc15',
    [['Vitinha', 'CM', 88, 23, 'Portugal'], ['Ruben Dias', 'CB', 88, 4, 'Portugal'], ['Bruno Fernandes', 'CAM', 87, 8, 'Portugal'], ['Joao Neves', 'CM', 86, 15, 'Portugal'], ['Diogo Costa', 'GK', 84, 22, 'Portugal']]),
  mkNation('nat_ned', 'Netherlands', 'NED', 'UEFA', 85, 'Xavi Hernandez', 84, 'possession',
    mkKit('#ff6600', '#141414', 'solid', '#ff6600', '#ff6600'),
    mkKit('#0b1f3a', '#ff6600', 'solid', '#0b1f3a', '#0b1f3a'), '#22c55e',
    [['Virgil van Dijk', 'CB', 88, 4, 'Netherlands'], ['Xavi Simons', 'CAM', 85, 7, 'Netherlands'], ['Cody Gakpo', 'LW', 84, 11, 'Netherlands'], ['Tijjani Reijnders', 'CM', 84, 14, 'Netherlands'], ['Bart Verbruggen', 'GK', 81, 1, 'Netherlands']]),
  mkNation('nat_ita', 'Italy', 'ITA', 'UEFA', 84, 'Roberto Mancini', 85, 'possession',
    mkKit('#0066cc', '#ffffff', 'solid', '#ffffff', '#0066cc'),
    mkKit('#f4f6f8', '#0066cc', 'solid', '#0066cc', '#f4f6f8'), '#22c55e',
    [['Gianluigi Donnarumma', 'GK', 89, 1, 'Italy'], ['Nicolo Barella', 'CM', 88, 18, 'Italy'], ['Alessandro Bastoni', 'CB', 88, 23, 'Italy'], ['Federico Dimarco', 'LB', 86, 3, 'Italy'], ['Sandro Tonali', 'CDM', 85, 8, 'Italy']]),
  mkNation('nat_bel', 'Belgium', 'BEL', 'UEFA', 82, 'Mark van Bommel', 80, 'balanced',
    mkKit('#991b1b', '#facc15', 'solid', '#991b1b', '#991b1b'),
    mkKit('#38bdf8', '#ffffff', 'solid', '#141414', '#38bdf8'), '#facc15',
    [['Thibaut Courtois', 'GK', 88, 1, 'Belgium'], ['Kevin De Bruyne', 'CAM', 86, 7, 'Belgium'], ['Jeremy Doku', 'LW', 83, 11, 'Belgium'], ['Amadou Onana', 'CDM', 82, 6, 'Belgium']]),
  mkNation('nat_uru', 'Uruguay', 'URU', 'CONMEBOL', 83, 'Marcelo Bielsa', 85, 'gegenpress',
    mkKit('#75b2dd', '#141414', 'solid', '#141414', '#141414'),
    mkKit('#f4f6f8', '#75b2dd', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Federico Valverde', 'CM', 88, 15, 'Uruguay'], ['Ronald Araujo', 'CB', 84, 4, 'Uruguay'], ['Darwin Nunez', 'ST', 82, 9, 'Uruguay'], ['Sergio Rochet', 'GK', 80, 1, 'Uruguay']]),
  mkNation('nat_cro', 'Croatia', 'CRO', 'UEFA', 81, 'Zlatko Dalic', 83, 'balanced',
    mkKit('#e30613', '#ffffff', 'hoops', '#ffffff', '#00529f'),
    mkKit('#003087', '#e30613', 'solid', '#003087', '#003087'), '#22c55e',
    [['Josko Gvardiol', 'LB', 86, 4, 'Croatia'], ['Luka Modric', 'CM', 83, 10, 'Croatia'], ['Ante Budimir', 'ST', 80, 16, 'Croatia'], ['Dominik Livakovic', 'GK', 81, 1, 'Croatia']]),
  mkNation('nat_col', 'Colombia', 'COL', 'CONMEBOL', 82, 'Nestor Lorenzo', 82, 'gegenpress',
    mkKit('#fcd116', '#003893', 'solid', '#003893', '#ce1126'),
    mkKit('#141418', '#f97316', 'solid', '#141418', '#141418'), '#22c55e',
    [['Luis Diaz', 'LW', 86, 7, 'Colombia'], ['Cucho Hernandez', 'ST', 81, 9, 'Colombia'], ['Daniel Munoz', 'RB', 81, 21, 'Colombia'], ['Camilo Vargas', 'GK', 79, 12, 'Colombia']]),
  mkNation('nat_mar', 'Morocco', 'MAR', 'CAF', 82, 'Walid Regragui', 83, 'low_block',
    mkKit('#c1272d', '#006233', 'solid', '#006233', '#c1272d'),
    mkKit('#f4f6f8', '#c1272d', 'solid', '#f4f6f8', '#f4f6f8'), '#facc15',
    [['Achraf Hakimi', 'RB', 87, 2, 'Morocco'], ['Brahim Diaz', 'CAM', 83, 10, 'Morocco'], ['Nayef Aguerd', 'CB', 81, 5, 'Morocco'], ['Yassine Bounou', 'GK', 84, 1, 'Morocco']]),
  mkNation('nat_jpn', 'Japan', 'JPN', 'AFC', 80, 'Hajime Moriyasu', 81, 'gegenpress',
    mkKit('#002366', '#ffffff', 'solid', '#002366', '#002366'),
    mkKit('#f4f6f8', '#dc2626', 'solid', '#141414', '#f4f6f8'), '#facc15',
    [['Kaoru Mitoma', 'LW', 83, 7, 'Japan'], ['Takefusa Kubo', 'RW', 82, 20, 'Japan'], ['Zion Suzuki', 'GK', 79, 1, 'Japan']]),
  mkNation('nat_usa', 'United States', 'USA', 'CONCACAF', 80, 'Steve Cherundolo', 78, 'gegenpress',
    mkKit('#f4f6f8', '#0a3161', 'sleeves', '#f4f6f8', '#f4f6f8'),
    mkKit('#0a3161', '#b31942', 'solid', '#0a3161', '#0a3161'), '#22c55e',
    [['Christian Pulisic', 'RW', 85, 10, 'USA'], ['Malik Tillman', 'CAM', 81, 14, 'USA'], ['Antonee Robinson', 'LB', 80, 5, 'USA'], ['Folarin Balogun', 'ST', 80, 20, 'USA']]),
  mkNation('nat_mex', 'Mexico', 'MEX', 'CONCACAF', 78, 'Rafael Marquez', 78, 'balanced',
    mkKit('#006847', '#ce1126', 'solid', '#ffffff', '#006847'),
    mkKit('#f4f6f8', '#006847', 'solid', '#006847', '#f4f6f8'), '#facc15',
    [['Santiago Gimenez', 'ST', 80, 9, 'Mexico'], ['Edson Alvarez', 'CDM', 80, 4, 'Mexico'], ['Raul Jimenez', 'ST', 78, 7, 'Mexico']]),
  mkNation('nat_sen', 'Senegal', 'SEN', 'CAF', 80, 'Pape Thiaw', 79, 'balanced',
    mkKit('#f4f6f8', '#00853f', 'solid', '#f4f6f8', '#f4f6f8'),
    mkKit('#00853f', '#fdef42', 'solid', '#00853f', '#00853f'), '#facc15',
    [['Nicolas Jackson', 'ST', 81, 7, 'Senegal'], ['Iliman Ndiaye', 'CAM', 79, 13, 'Senegal'], ['Moussa Niakhate', 'CB', 80, 19, 'Senegal'], ['Edouard Mendy', 'GK', 80, 16, 'Senegal']]),
  mkNation('nat_sui', 'Switzerland', 'SUI', 'UEFA', 80, 'Murat Yakin', 80, 'low_block',
    mkKit('#da291c', '#ffffff', 'solid', '#ffffff', '#da291c'),
    mkKit('#f4f6f8', '#1e3a8a', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Gregor Kobel', 'GK', 87, 1, 'Switzerland'], ['Manuel Akanji', 'CB', 84, 5, 'Switzerland'], ['Granit Xhaka', 'CDM', 83, 10, 'Switzerland']]),
  mkNation('nat_den', 'Denmark', 'DEN', 'UEFA', 80, 'Brian Riemer', 79, 'balanced',
    mkKit('#c60c30', '#ffffff', 'solid', '#ffffff', '#c60c30'),
    mkKit('#f4f6f8', '#c60c30', 'solid', '#c60c30', '#f4f6f8'), '#22c55e',
    [['Morten Hjulmand', 'CDM', 84, 21, 'Denmark'], ['Rasmus Hojlund', 'ST', 83, 9, 'Denmark'], ['Pierre-Emile Hojbjerg', 'CDM', 82, 23, 'Denmark']]),
  mkNation('nat_aut', 'Austria', 'AUT', 'UEFA', 79, 'Ralf Rangnick', 82, 'gegenpress',
    mkKit('#ed2939', '#ffffff', 'solid', '#ed2939', '#ed2939'),
    mkKit('#f4f6f8', '#141414', 'solid', '#141414', '#f4f6f8'), '#facc15',
    [['Konrad Laimer', 'CM', 83, 20, 'Austria'], ['Marcel Sabitzer', 'CM', 81, 9, 'Austria'], ['Romano Schmid', 'CAM', 78, 18, 'Austria']]),
  mkNation('nat_pol', 'Poland', 'POL', 'UEFA', 77, 'Michal Probierz', 75, 'route_one',
    mkKit('#f4f6f8', '#dc143c', 'solid', '#dc143c', '#f4f6f8'),
    mkKit('#dc143c', '#ffffff', 'solid', '#dc143c', '#dc143c'), '#22c55e',
    [['Robert Lewandowski', 'ST', 85, 9, 'Poland'], ['Piotr Zielinski', 'CM', 82, 10, 'Poland'], ['Lukasz Skorupski', 'GK', 79, 1, 'Poland']]),
  mkNation('nat_ukr', 'Ukraine', 'UKR', 'UEFA', 78, 'Serhiy Rebrov', 77, 'balanced',
    mkKit('#ffd700', '#0057b7', 'solid', '#ffd700', '#ffd700'),
    mkKit('#0057b7', '#ffd700', 'solid', '#0057b7', '#0057b7'), '#22c55e',
    [['Illia Zabarnyi', 'CB', 82, 13, 'Ukraine'], ['Artem Dovbyk', 'ST', 80, 11, 'Ukraine'], ['Andriy Lunin', 'GK', 81, 1, 'Ukraine']]),
  mkNation('nat_tur', 'Turkey', 'TUR', 'UEFA', 81, 'Vincenzo Montella', 81, 'gegenpress',
    mkKit('#f4f6f8', '#e30a17', 'hoops', '#f4f6f8', '#f4f6f8'),
    mkKit('#e30a17', '#ffffff', 'solid', '#e30a17', '#e30a17'), '#22c55e',
    [['Hakan Calhanoglu', 'CDM', 85, 10, 'Turkey'], ['Arda Guler', 'RW', 84, 8, 'Turkey'], ['Kenan Yildiz', 'LW', 84, 19, 'Turkey']]),
  mkNation('nat_kor', 'South Korea', 'KOR', 'AFC', 78, 'Hong Myung-bo', 77, 'balanced',
    mkKit('#cd2e3a', '#0047a0', 'solid', '#cd2e3a', '#cd2e3a'),
    mkKit('#141416', '#ec4899', 'solid', '#141416', '#141416'), '#facc15',
    [['Heung-Min Son', 'LW', 84, 7, 'South Korea'], ['Kang-In Lee', 'CAM', 81, 18, 'South Korea'], ['Min-Jae Kim', 'CB', 83, 4, 'South Korea']]),
  mkNation('nat_nga', 'Nigeria', 'NGA', 'CAF', 79, 'Eric Chelle', 77, 'gegenpress',
    mkKit('#008751', '#ffffff', 'solid', '#008751', '#008751'),
    mkKit('#141416', '#008751', 'solid', '#141416', '#141416'), '#facc15',
    [['Victor Osimhen', 'ST', 87, 9, 'Nigeria'], ['Ademola Lookman', 'LW', 85, 7, 'Nigeria'], ['Calvin Bassey', 'CB', 78, 21, 'Nigeria']]),
  mkNation('nat_civ', 'Ivory Coast', 'CIV', 'CAF', 79, 'Emerse Fae', 79, 'balanced',
    mkKit('#ff7900', '#ffffff', 'solid', '#ff7900', '#ff7900'),
    mkKit('#f4f6f8', '#009e60', 'solid', '#f4f6f8', '#f4f6f8'), '#38bdf8',
    [['Amad Diallo', 'LW', 82, 16, 'Ivory Coast'], ['Franck Kessie', 'CM', 80, 8, 'Ivory Coast'], ['Seko Fofana', 'CM', 79, 6, 'Ivory Coast']]),
  mkNation('nat_egy', 'Egypt', 'EGY', 'CAF', 78, 'Hossam Hassan', 76, 'low_block',
    mkKit('#ce1126', '#141414', 'solid', '#ffffff', '#141414'),
    mkKit('#f4f6f8', '#ce1126', 'solid', '#141414', '#f4f6f8'), '#22c55e',
    [['Mohamed Salah', 'RW', 87, 10, 'Egypt'], ['Omar Marmoush', 'LW', 84, 7, 'Egypt'], ['Mohamed El-Shenawy', 'GK', 77, 1, 'Egypt']]),
  mkNation('nat_sco', 'Scotland', 'SCO', 'UEFA', 78, 'Steve Clarke', 78, 'route_one',
    mkKit('#00285e', '#ffffff', 'solid', '#00285e', '#00285e'),
    mkKit('#f4f6f8', '#00285e', 'solid', '#00285e', '#f4f6f8'), '#22c55e',
    [['Scott McTominay', 'CM', 86, 4, 'Scotland'], ['Andy Robertson', 'LB', 82, 3, 'Scotland'], ['Lewis Ferguson', 'CM', 81, 19, 'Scotland']]),
  mkNation('nat_swe', 'Sweden', 'SWE', 'UEFA', 79, 'Jon Dahl Tomasson', 78, 'gegenpress',
    mkKit('#fecb00', '#005293', 'solid', '#005293', '#fecb00'),
    mkKit('#141c2e', '#fecb00', 'solid', '#141c2e', '#141c2e'), '#22c55e',
    [['Alexander Isak', 'ST', 88, 9, 'Sweden'], ['Viktor Gyokeres', 'ST', 87, 17, 'Sweden'], ['Dejan Kulusevski', 'RW', 84, 21, 'Sweden']]),
  mkNation('nat_nor', 'Norway', 'NOR', 'UEFA', 81, 'Stale Solbakken', 79, 'balanced',
    mkKit('#ba0c2f', '#00205b', 'solid', '#00205b', '#ba0c2f'),
    mkKit('#f4f6f8', '#00205b', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Erling Haaland', 'ST', 92, 9, 'Norway'], ['Martin Odegaard', 'CAM', 88, 10, 'Norway'], ['Antonio Nusa', 'LW', 82, 20, 'Norway'], ['Orjan Nyland', 'GK', 78, 1, 'Norway']]),
  mkNation('nat_srb', 'Serbia', 'SRB', 'UEFA', 77, 'Dragan Stojkovic', 76, 'route_one',
    mkKit('#c6363c', '#0c4076', 'solid', '#c6363c', '#c6363c'),
    mkKit('#f4f6f8', '#c6363c', 'solid', '#f4f6f8', '#f4f6f8'), '#22c55e',
    [['Dusan Vlahovic', 'ST', 83, 9, 'Serbia'], ['Mile Svilar', 'GK', 83, 1, 'Serbia'], ['Strahinja Pavlovic', 'CB', 82, 2, 'Serbia']]),
];

// Classic Quick-Match Derby Preset
export const CLASSIC_TEAMS = [
  mkClub('classic_scd', 'classic', 'Sporting Club Draguignan', 'Draguignan', 'SCD', 79, 'Laurent Blanc', 78, 'balanced',
    mkKit('#f4f6f8', '#15171a', 'solid', '#15171a', '#f4f6f8'),
    mkKit('#15171a', '#f4f6f8', 'solid', '#15171a', '#15171a'), '#3fb950',
    [['G. Acher', 'LW', 82, 10, 'France'], ['M. Acher', 'ST', 82, 7, 'France'], ['Lea Acher', 'RW', 79, 9, 'France'], ['Francette', 'GK', 78, 1, 'France']]),
  mkClub('classic_ssa', 'classic', 'Stade Saint-Aubinais', 'Saint-Aubin', 'SSA', 78, 'Julien Stephan', 77, 'balanced',
    mkKit('#cc1122', '#141416', 'solid', '#141416', '#cc1122'),
    mkKit('#f4f6f8', '#cc1122', 'solid', '#141416', '#f4f6f8'), '#f5a623',
    [['Ruellan', 'ST', 80, 9, 'France'], ['Trehorel', 'LW', 79, 7, 'France'], ['Gernigon', 'CAM', 79, 10, 'France'], ['Hamon', 'GK', 78, 1, 'France']]),
];

const FIRST_NAMES_POOL = {
  England: ['Jack', 'Harry', 'Oliver', 'George', 'Ben', 'Sam', 'Tom', 'Luke', 'Mason', 'Owen', 'Callum', 'Ethan'],
  Spain: ['Pablo', 'Carlos', 'Hugo', 'Alvaro', 'Marc', 'Iker', 'Jordi', 'Dani', 'Diego', 'Sergio', 'Mario', 'Ivan'],
  Italy: ['Marco', 'Luca', 'Matteo', 'Lorenzo', 'Andrea', 'Davide', 'Simone', 'Filippo', 'Federico', 'Nicolo'],
  Germany: ['Lukas', 'Jonas', 'Felix', 'Leon', 'Tim', 'Max', 'Julian', 'Niklas', 'Tobias', 'Jan', 'Moritz'],
  France: ['Lucas', 'Theo', 'Hugo', 'Enzo', 'Leo', 'Baptiste', 'Thomas', 'Clement', 'Romain', 'Nathan', 'Maxime'],
  Default: ['Alex', 'Lucas', 'Mateo', 'Daniel', 'David', 'Gabriel', 'Victor', 'Rafael', 'Noah', 'Leo', 'Samuel'],
};

const LAST_NAMES_POOL = {
  England: ['Walker', 'Taylor', 'Clarke', 'Wright', 'Edwards', 'Harrison', 'Bennett', 'Cooper', 'Ward', 'Brooks', 'Turner', 'Mitchell', 'Parker', 'Kelly'],
  Spain: ['Garcia', 'Lopez', 'Martinez', 'Sanchez', 'Torres', 'Ruiz', 'Navarro', 'Alonso', 'Moreno', 'Gomez', 'Vega', 'Serrano', 'Molina', 'Castro'],
  Italy: ['Rossi', 'Bianchi', 'Conti', 'Moretti', 'Esposito', 'Ricci', 'Greco', 'Rinaldi', 'Marchetti', 'Bellini', 'Ferrara', 'Galli', 'Caruso', 'Barbieri'],
  Germany: ['Muller', 'Weber', 'Becker', 'Hoffmann', 'Schulz', 'Koch', 'Bauer', 'Richter', 'Klein', 'Keller', 'Werner', 'Wagner', 'Brandt', 'Hartmann'],
  France: ['Martin', 'Bernard', 'Dubois', 'Moreau', 'Laurent', 'Simon', 'Lefevre', 'Roux', 'Girard', 'Mercier', 'Dupont', 'Chevalier', 'Fournier', 'Lemaire'],
  Default: ['Silva', 'Costa', 'Novak', 'Kovacs', 'Jansen', 'Petrov', 'Bauer', 'Sato', 'Mendes', 'Diallo', 'Ndiaye', 'Vidal', 'Cruz', 'Lindqvist'],
};

const SLOT_TEMPLATE = [
  'GK', 'GK',
  'LB', 'CB', 'CB', 'RB', 'CB', 'LB',
  'CDM', 'CM', 'CM', 'CAM', 'CM', 'CDM',
  'LW', 'ST', 'RW', 'ST',
];

const DEFAULT_NUMS = [1, 13, 3, 4, 5, 2, 15, 21, 6, 8, 14, 10, 16, 18, 11, 9, 7, 19];

export const FORMATIONS = {
  '4-3-3': {
    id: '4-3-3',
    name: '4-3-3',
    desc: 'Balanced front three with wide wingers and a holding pivot.',
    gk: { label: 'GK', pos: 'GK', line: 'GK', boardX: 50, boardY: 91 },
    slots: [
      { label: 'LB',  pos: 'LB',  line: 'DF', x: -32, z: -24,   boardX: 14, boardY: 72 },
      { label: 'LCB', pos: 'CB',  line: 'DF', x: -35, z: -8.5,  boardX: 37, boardY: 76 },
      { label: 'RCB', pos: 'CB',  line: 'DF', x: -35, z: 8.5,   boardX: 63, boardY: 76 },
      { label: 'RB',  pos: 'RB',  line: 'DF', x: -32, z: 24,    boardX: 86, boardY: 72 },
      { label: 'LCM', pos: 'CM',  line: 'MF', x: -15, z: -13.5, boardX: 25, boardY: 48 },
      { label: 'CDM', pos: 'CDM', line: 'MF', x: -21, z: 0,     boardX: 50, boardY: 57 },
      { label: 'RCM', pos: 'CM',  line: 'MF', x: -15, z: 13.5,  boardX: 75, boardY: 48 },
      { label: 'LW',  pos: 'LW',  line: 'FW', x: 2,   z: -24.5, boardX: 16, boardY: 23 },
      { label: 'ST',  pos: 'ST',  line: 'FW', x: 6,   z: 0,     boardX: 50, boardY: 14 },
      { label: 'RW',  pos: 'RW',  line: 'FW', x: 2,   z: 24.5,  boardX: 84, boardY: 23 },
    ],
  },
  '4-4-2': {
    id: '4-4-2',
    name: '4-4-2',
    desc: 'Classic two-bank compact defense with a twin-striker partnership.',
    gk: { label: 'GK', pos: 'GK', line: 'GK', boardX: 50, boardY: 91 },
    slots: [
      { label: 'LB',  pos: 'LB', line: 'DF', x: -32, z: -24,   boardX: 14, boardY: 73 },
      { label: 'LCB', pos: 'CB', line: 'DF', x: -35, z: -8.5,  boardX: 37, boardY: 77 },
      { label: 'RCB', pos: 'CB', line: 'DF', x: -35, z: 8.5,   boardX: 63, boardY: 77 },
      { label: 'RB',  pos: 'RB', line: 'DF', x: -32, z: 24,    boardX: 86, boardY: 73 },
      { label: 'LM',  pos: 'LW', line: 'MF', x: -12, z: -23.5, boardX: 14, boardY: 48 },
      { label: 'LCM', pos: 'CM', line: 'MF', x: -17, z: -7.5,  boardX: 38, boardY: 52 },
      { label: 'RCM', pos: 'CM', line: 'MF', x: -17, z: 7.5,   boardX: 62, boardY: 52 },
      { label: 'RM',  pos: 'RW', line: 'MF', x: -12, z: 23.5,  boardX: 86, boardY: 48 },
      { label: 'LST', pos: 'ST', line: 'FW', x: 6,   z: -7.5,  boardX: 37, boardY: 18 },
      { label: 'RST', pos: 'ST', line: 'FW', x: 6,   z: 7.5,   boardX: 63, boardY: 18 },
    ],
  },
  '4-2-3-1': {
    id: '4-2-3-1',
    name: '4-2-3-1',
    desc: 'Double pivot shield releasing a central playmaker behind one striker.',
    gk: { label: 'GK', pos: 'GK', line: 'GK', boardX: 50, boardY: 91 },
    slots: [
      { label: 'LB',  pos: 'LB',  line: 'DF', x: -32, z: -24,  boardX: 14, boardY: 74 },
      { label: 'LCB', pos: 'CB',  line: 'DF', x: -35, z: -8.5, boardX: 37, boardY: 77 },
      { label: 'RCB', pos: 'CB',  line: 'DF', x: -35, z: 8.5,  boardX: 63, boardY: 77 },
      { label: 'RB',  pos: 'RB',  line: 'DF', x: -32, z: 24,   boardX: 86, boardY: 74 },
      { label: 'LDM', pos: 'CDM', line: 'MF', x: -21, z: -8.5, boardX: 36, boardY: 56 },
      { label: 'RDM', pos: 'CDM', line: 'MF', x: -21, z: 8.5,  boardX: 64, boardY: 56 },
      { label: 'LAM', pos: 'LW',  line: 'MF', x: -5,  z: -21,  boardX: 18, boardY: 35 },
      { label: 'CAM', pos: 'CAM', line: 'MF', x: -6,  z: 0,    boardX: 50, boardY: 37 },
      { label: 'RAM', pos: 'RW',  line: 'MF', x: -5,  z: 21,   boardX: 82, boardY: 35 },
      { label: 'ST',  pos: 'ST',  line: 'FW', x: 7,   z: 0,    boardX: 50, boardY: 14 },
    ],
  },
  '3-5-2': {
    id: '3-5-2',
    name: '3-5-2',
    desc: 'Back three with raiding wingbacks, midfield overload, and two strikers.',
    gk: { label: 'GK', pos: 'GK', line: 'GK', boardX: 50, boardY: 91 },
    slots: [
      { label: 'LCB', pos: 'CB',  line: 'DF', x: -35, z: -14.5, boardX: 25, boardY: 75 },
      { label: 'CCB', pos: 'CB',  line: 'DF', x: -36, z: 0,     boardX: 50, boardY: 77 },
      { label: 'RCB', pos: 'CB',  line: 'DF', x: -35, z: 14.5,  boardX: 75, boardY: 75 },
      { label: 'LWB', pos: 'LB',  line: 'MF', x: -17, z: -25.5, boardX: 12, boardY: 49 },
      { label: 'LCM', pos: 'CM',  line: 'MF', x: -17, z: -9.5,  boardX: 34, boardY: 53 },
      { label: 'CAM', pos: 'CAM', line: 'MF', x: -9,  z: 0,     boardX: 50, boardY: 37 },
      { label: 'RCM', pos: 'CM',  line: 'MF', x: -17, z: 9.5,   boardX: 66, boardY: 53 },
      { label: 'RWB', pos: 'RB',  line: 'MF', x: -17, z: 25.5,  boardX: 88, boardY: 49 },
      { label: 'LST', pos: 'ST',  line: 'FW', x: 6,   z: -7.5,  boardX: 37, boardY: 17 },
      { label: 'RST', pos: 'ST',  line: 'FW', x: 6,   z: 7.5,   boardX: 63, boardY: 17 },
    ],
  },
  '4-1-4-1': {
    id: '4-1-4-1',
    name: '4-1-4-1',
    desc: 'Single deep anchor protecting four midfield runners behind a lone forward.',
    gk: { label: 'GK', pos: 'GK', line: 'GK', boardX: 50, boardY: 91 },
    slots: [
      { label: 'LB',  pos: 'LB',  line: 'DF', x: -32, z: -24,   boardX: 14, boardY: 74 },
      { label: 'LCB', pos: 'CB',  line: 'DF', x: -35, z: -8.5,  boardX: 37, boardY: 77 },
      { label: 'RCB', pos: 'CB',  line: 'DF', x: -35, z: 8.5,   boardX: 63, boardY: 77 },
      { label: 'RB',  pos: 'RB',  line: 'DF', x: -32, z: 24,    boardX: 86, boardY: 74 },
      { label: 'CDM', pos: 'CDM', line: 'MF', x: -23, z: 0,     boardX: 50, boardY: 60 },
      { label: 'LM',  pos: 'LW',  line: 'MF', x: -8,  z: -23.5, boardX: 15, boardY: 39 },
      { label: 'LCM', pos: 'CM',  line: 'MF', x: -13, z: -8.5,  boardX: 37, boardY: 43 },
      { label: 'RCM', pos: 'CM',  line: 'MF', x: -13, z: 8.5,   boardX: 63, boardY: 43 },
      { label: 'RM',  pos: 'RW',  line: 'MF', x: -8,  z: 23.5,  boardX: 85, boardY: 39 },
      { label: 'ST',  pos: 'ST',  line: 'FW', x: 7,   z: 0,     boardX: 50, boardY: 14 },
    ],
  },
};

export const FORMATION_IDS = ['4-3-3', '4-4-2', '4-2-3-1', '3-5-2', '4-1-4-1'];

export function getFormation(id) {
  return FORMATIONS[id] || FORMATIONS['4-3-3'];
}

export function computeSquadOvr(pos, attrs) {
  const a = attrs || {};
  const p = a.pace || 70;
  const sh = a.shoot ?? a.shooting ?? 70;
  const pa = a.pass ?? a.passing ?? 70;
  const dr = a.dribble ?? a.dribbling ?? 70;
  const df = a.def ?? a.defending ?? 70;
  const ph = a.phys ?? a.physical ?? 70;
  if (pos === 'GK') return Math.round(df * 0.36 + ph * 0.24 + pa * 0.16 + p * 0.12 + dr * 0.12);
  if (pos === 'CB') return Math.round(df * 0.38 + ph * 0.28 + pa * 0.14 + p * 0.12 + dr * 0.08);
  if (pos === 'LB' || pos === 'RB') return Math.round(df * 0.26 + p * 0.24 + pa * 0.18 + dr * 0.16 + ph * 0.16);
  if (pos === 'CDM') return Math.round(df * 0.28 + pa * 0.26 + ph * 0.20 + dr * 0.14 + p * 0.12);
  if (pos === 'CM') return Math.round(pa * 0.30 + dr * 0.22 + df * 0.16 + ph * 0.14 + p * 0.10 + sh * 0.08);
  if (pos === 'CAM') return Math.round(pa * 0.28 + dr * 0.28 + sh * 0.22 + p * 0.14 + ph * 0.08);
  if (pos === 'LW' || pos === 'RW') return Math.round(p * 0.26 + dr * 0.28 + sh * 0.22 + pa * 0.16 + ph * 0.08);
  return Math.round(sh * 0.34 + p * 0.22 + dr * 0.20 + ph * 0.16 + pa * 0.08);
}

function buildAttrsFor(pos, targetOvr, rng, age = 25, preserveOvr = false) {
  const clampA = (v) => Math.max(36, Math.min(97, Math.round(v)));
  const isGK = pos === 'GK';
  const isDF = pos === 'CB' || pos === 'LB' || pos === 'RB';
  const isFB = pos === 'LB' || pos === 'RB';
  const isMF = pos === 'CDM' || pos === 'CM' || pos === 'CAM';

  // Archetype tilt so players in the same position still feel distinct (speedster vs creator vs enforcer)
  const arch = rng();
  const speedBias = !isGK && arch < 0.34 ? 5 : !isGK && arch > 0.72 ? -3 : 0;
  const techBias = arch >= 0.34 && arch < 0.68 ? 4 : 0;
  const physBias = arch >= 0.68 ? 5 : arch < 0.34 ? -3 : 0;
  const agePaceDelta = age <= 21 ? 3 : age >= 31 ? -5 : 0;
  const agePhysDelta = age <= 20 ? -5 : age >= 28 ? 3 : 0;
  const ageIQDelta = age >= 30 ? 3 : age <= 20 ? -2 : 0;

  const j = (span = 9) => Math.round((rng() - 0.5) * span);
  const base = targetOvr;

  const pace = clampA(base + (isGK ? -24 : isFB ? 5 : pos === 'LW' || pos === 'RW' ? 6 : pos === 'CB' ? -4 : 1) + speedBias + agePaceDelta + j(10));
  const shoot = clampA(base + (isGK ? -34 : pos === 'ST' ? 4 : isDF ? -17 : isMF ? -4 : 2) + (arch < 0.4 ? 2 : -1) + j(10));
  const pass = clampA(base + (isGK ? -10 : isMF ? 4 : pos === 'CB' ? -6 : 0) + techBias + ageIQDelta + j(9));
  const dribble = clampA(base + (isGK ? -27 : pos === 'LW' || pos === 'RW' || pos === 'CAM' ? 4 : pos === 'CB' ? -12 : 0) + techBias + j(9));
  const def = clampA(base + (isGK ? 3 : isDF ? 4 : pos === 'CDM' ? 3 : -28) + (physBias > 0 ? 2 : 0) + j(9));
  const phys = clampA(base + (isGK ? 0 : pos === 'CB' || pos === 'CDM' ? 4 : -1) + physBias + agePhysDelta + j(10));

  const attrs = { pace, shoot, pass, dribble, def, phys };
  const derived = computeSquadOvr(pos, attrs);
  if (preserveOvr) {
    // Keep named stars' attributes aligned with their canonical listed OVR
    const shift = targetOvr - derived;
    if (shift !== 0) {
      for (const k of Object.keys(attrs)) attrs[k] = clampA(attrs[k] + shift);
    }
    return { attrs, ovr: targetOvr };
  }
  return { attrs, ovr: Math.max(58, Math.min(94, derived)) };
}

function buildSquadRoster(team) {
  const rng = makeDetRng(hashStr(team.id));
  const league = LEAGUES.find((l) => l.id === team.leagueId);
  const homeNat = league ? league.country : (team.type === 'nation' ? team.name : 'France');
  const roster = [];
  const usedNums = new Set();
  const filledSlots = new Array(18).fill(false);

  // Place named stars into matching positional slots first
  for (const [name, pos, ovr, num, nat] of (team.stars || [])) {
    let slotIdx = SLOT_TEMPLATE.findIndex((s, i) => !filledSlots[i] && s === pos);
    if (slotIdx < 0) slotIdx = SLOT_TEMPLATE.findIndex((s, i) => !filledSlots[i] && posToEngineRole(s) === posToEngineRole(pos));
    if (slotIdx < 0) slotIdx = filledSlots.findIndex((f) => !f);
    if (slotIdx >= 0) filledSlots[slotIdx] = true;
    usedNums.add(num);
    const age = 20 + Math.floor(rng() * 12);
    const built = buildAttrsFor(pos, ovr, rng, age, true);
    roster.push({
      id: `${team.id}_${num}_${hashStr(name) & 0xffff}`,
      name,
      pos,
      role: posToEngineRole(pos),
      ovr: built.ovr,
      number: num,
      age,
      nat: nat || homeNat,
      attrs: built.attrs,
    });
  }

  const firsts = FIRST_NAMES_POOL[homeNat] || FIRST_NAMES_POOL.Default;
  const lasts = LAST_NAMES_POOL[homeNat] || LAST_NAMES_POOL.Default;
  const usedNames = new Set(roster.map((p) => p.name));

  // Varied squad depth profile so generated teammates have realistic spread (key regulars, fringe starters, rotation, youth, vets)
  const openSlots = [];
  for (let i = 0; i < 18; i++) if (!filledSlots[i]) openSlots.push(i);
  const starterGoal = Math.max(0, 11 - roster.length);
  // Deterministic tier deltas spanning starter stars, regular XI, bench options, and youth prospects
  const starterPool = [1, 0, -1, -1, -2, -2, -3, -3, -4, -4, -5];
  const benchPool = [-4, -5, -6, -6, -7, -8, -9, -10, -11, -12];

  openSlots.forEach((i, openIdx) => {
    const pos = SLOT_TEMPLATE[i];
    let num = DEFAULT_NUMS[i];
    while (usedNums.has(num)) num = (num % 44) + 1;
    usedNums.add(num);

    let full = '';
    for (let k = 0; k < 12; k++) {
      const fn = firsts[Math.floor(rng() * firsts.length)];
      const ln = lasts[Math.floor(rng() * lasts.length)];
      full = `${fn} ${ln}`;
      if (!usedNames.has(full)) break;
    }
    usedNames.add(full);

    const isStarterTier = openIdx < starterGoal;
    const isYouth = !isStarterTier && openIdx >= openSlots.length - 2;
    const isVeteran = !isYouth && rng() < 0.22;
    const baseDelta = isStarterTier
      ? starterPool[Math.min(openIdx, starterPool.length - 1)]
      : (isYouth ? (-8 - Math.floor(rng() * 5)) : benchPool[Math.min(openIdx - starterGoal, benchPool.length - 1)]);
    const jitter = Math.round((rng() - 0.5) * 2);
    const targetOvr = Math.max(58, Math.min(91, team.rating + baseDelta + jitter));
    const age = isYouth ? (17 + Math.floor(rng() * 4)) : (isVeteran ? (30 + Math.floor(rng() * 5)) : (21 + Math.floor(rng() * 8)));
    const built = buildAttrsFor(pos, targetOvr, rng, age, false);

    roster.push({
      id: `${team.id}_g_${i}`,
      name: full,
      pos,
      role: posToEngineRole(pos),
      ovr: built.ovr,
      number: num,
      age,
      nat: homeNat,
      attrs: built.attrs,
    });
  });

  // Sort starting XI cleanly: 1 GK, 4 DF, 3 MF, 3 FW first, highest OVR within each role
  const roleOrder = { GK: 0, DF: 1, MF: 2, FW: 3 };
  roster.sort((a, b) => (roleOrder[a.role] - roleOrder[b.role]) || (b.ovr - a.ovr));
  return roster;
}

export const CLUBS = RAW_CLUBS.map((c) => ({ ...c, squad: buildSquadRoster(c) }));
export const NATIONS = NATIONAL_TEAMS.map((n) => ({ ...n, squad: buildSquadRoster(n) }));
export const CLASSIC_PRESET_CLUBS = CLASSIC_TEAMS.map((c) => ({ ...c, squad: buildSquadRoster(c) }));

export const ALL_TEAMS = [...CLUBS, ...NATIONS, ...CLASSIC_PRESET_CLUBS];
const TEAM_BY_ID = new Map(ALL_TEAMS.map((t) => [t.id, t]));

export function getTeamById(id) {
  return TEAM_BY_ID.get(id) || CLUBS[0];
}

export function getClubsByLeague(leagueId) {
  return CLUBS.filter((c) => c.leagueId === leagueId);
}

function slotFitBonus(player, slot) {
  if (!player || !slot) return 0;
  if (slot.pos === 'GK') return player.role === 'GK' ? 60 : -80;
  if (player.role === 'GK') return -80;
  if (player.pos === slot.pos) return 26;
  const pRole = player.role || posToEngineRole(player.pos);
  const sRole = posToEngineRole(slot.pos);
  if (pRole === sRole) {
    if ((player.pos === 'LW' || player.pos === 'RW') && (slot.pos === 'LW' || slot.pos === 'RW')) return 20;
    if ((player.pos === 'LB' || player.pos === 'RB') && (slot.pos === 'LB' || slot.pos === 'RB')) return 19;
    return 15;
  }
  if (pRole === 'FW' && slot.line === 'MF' && (slot.pos === 'LW' || slot.pos === 'RW' || slot.pos === 'CAM')) return 14;
  if (pRole === 'MF' && slot.line === 'FW' && (slot.pos === 'LW' || slot.pos === 'RW')) return 10;
  if (pRole === 'DF' && (slot.pos === 'LB' || slot.pos === 'RB') && slot.line === 'MF') return 14;
  if (Math.abs((pRole === 'DF' ? 0 : pRole === 'MF' ? 1 : 2) - (sRole === 'DF' ? 0 : sRole === 'MF' ? 1 : 2)) === 1) return 3;
  return -12;
}

export function isSlotMismatch(player, slot) {
  if (!player || !slot) return false;
  if (slot.pos === 'GK') return player.role !== 'GK';
  if (player.role === 'GK') return true;
  if (player.pos === slot.pos) return false;
  const pRole = player.role || posToEngineRole(player.pos);
  const sRole = posToEngineRole(slot.pos);
  if (pRole === sRole) return false;
  if (pRole === 'FW' && slot.line === 'MF' && (slot.pos === 'LW' || slot.pos === 'RW' || slot.pos === 'CAM')) return false;
  if (pRole === 'DF' && (slot.pos === 'LB' || slot.pos === 'RB') && slot.line === 'MF') return false;
  if (pRole === 'MF' && (slot.pos === 'LW' || slot.pos === 'RW' || slot.pos === 'CAM')) return false;
  return true;
}

export function buildOrderedSquad(squad, proPlayer = null, formationId = '4-3-3') {
  const form = getFormation(formationId);
  const pool = squad.slice();
  const used = new Set();
  const xi = new Array(11).fill(null);

  // Assign GK slot (0)
  if (proPlayer && proPlayer.role === 'GK') {
    xi[0] = proPlayer;
    used.add(proPlayer);
  } else {
    const gkPool = pool.filter((p) => p.role === 'GK').sort((a, b) => b.ovr - a.ovr);
    if (gkPool[0]) {
      xi[0] = gkPool[0];
      used.add(gkPool[0]);
    }
  }

  // Assign Pro into best matching outfield slot first if present
  if (proPlayer && proPlayer.role !== 'GK') {
    let bestSlot = -1;
    let bestScore = -1e9;
    form.slots.forEach((sl, sIdx) => {
      const sc = slotFitBonus(proPlayer, sl) + (sl.line === proPlayer.role ? 8 : 0);
      if (sc > bestScore) { bestScore = sc; bestSlot = sIdx; }
    });
    if (bestSlot >= 0) {
      xi[bestSlot + 1] = proPlayer;
      used.add(proPlayer);
    }
  }

  // Fill remaining outfield slots in 2 passes: exact/strong natural fits first, then best remaining OVR
  for (let pass = 0; pass < 2; pass++) {
    form.slots.forEach((sl, sIdx) => {
      if (xi[sIdx + 1]) return;
      const cands = pool.filter((p) => !used.has(p) && (pass === 1 || slotFitBonus(p, sl) >= 14));
      if (!cands.length) return;
      cands.sort((a, b) => (b.ovr + slotFitBonus(b, sl) * 0.65) - (a.ovr + slotFitBonus(a, sl) * 0.65));
      xi[sIdx + 1] = cands[0];
      used.add(cands[0]);
    });
  }

  // Fill GK fallback if somehow empty
  if (!xi[0]) {
    const rest = pool.filter((p) => !used.has(p)).sort((a, b) => b.ovr - a.ovr);
    if (rest[0]) { xi[0] = rest[0]; used.add(rest[0]); }
  }

  const bench = pool.filter((p) => !used.has(p)).sort((a, b) => b.ovr - a.ovr);
  const cleanXi = xi.filter(Boolean).slice(0, 11);
  return {
    lineup: cleanXi,
    bench,
    ordered: [...cleanXi, ...bench],
  };
}

export function pickStartingXI(squad, proPlayer = null, formationId = '4-3-3') {
  return buildOrderedSquad(squad, proPlayer, formationId).lineup;
}

// Color distance in sRGB (0..442) to detect kit clashes cleanly
export function colorDistance(hexA, hexB) {
  const a = parseInt((hexA || '#000000').replace('#', ''), 16);
  const b = parseInt((hexB || '#ffffff').replace('#', ''), 16);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const rMean = (ar + br) * 0.5;
  const dr = ar - br, dg = ag - bg, db = ab - bb;
  return Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
}

export function resolveMatchKits(homeTeam, awayTeam, homePref = 'home', awayPref = 'auto') {
  const hChoice = homePref === 'away' ? 'away' : 'home';
  const hKit = hChoice === 'away' ? homeTeam.awayKit : homeTeam.homeKit;
  let aChoice = awayPref === 'away' ? 'away' : 'home';
  let clashed = colorDistance(hKit.primary, awayTeam.homeKit.primary) < 165;
  if (awayPref === 'auto') {
    aChoice = clashed ? 'away' : 'home';
  }
  let aKit = aChoice === 'away' ? awayTeam.awayKit : awayTeam.homeKit;
  // Rare edge case if even away kit clashes closely -> switch away kit to fallback contrast dark/white
  if (colorDistance(hKit.primary, aKit.primary) < 120) {
    const dark = hexLum(hKit.primary) > 0.48;
    aKit = mkKit(dark ? '#161b26' : '#f4f6f8', aKit.secondary || (dark ? '#f4cd72' : '#161b26'), aKit.pattern);
  }
  return { homeChoice: hChoice, awayChoice: aChoice, homeKit: hKit, awayKit: aKit, autoSwitched: awayPref === 'auto' && clashed };
}

export function renderJerseySvg(kit, size = 44, number = '') {
  const k = kit || mkKit('#dc2626', '#ffffff', 'solid');
  const p = k.primary || '#dc2626';
  const s = k.secondary || '#ffffff';
  const uid = 'k_' + hashStr(`${p}_${s}_${k.pattern}_${size}`).toString(36);
  let patternFill = '';
  if (k.pattern === 'stripes') {
    patternFill = `<pattern id="${uid}" width="12" height="64" patternUnits="userSpaceOnUse"><rect width="6" height="64" fill="${p}"/><rect x="6" width="6" height="64" fill="${s}"/></pattern>`;
  } else if (k.pattern === 'hoops') {
    patternFill = `<pattern id="${uid}" width="64" height="12" patternUnits="userSpaceOnUse"><rect width="64" height="6" fill="${p}"/><rect y="6" width="64" height="6" fill="${s}"/></pattern>`;
  }
  const bodyFill = (k.pattern === 'stripes' || k.pattern === 'hoops') ? `url(#${uid})` : p;
  const sleeveFill = k.pattern === 'sleeves' ? s : p;
  const sash = k.pattern === 'sash'
    ? `<polygon points="18,14 26,14 48,54 40,54" fill="${s}" opacity="0.92"/>`
    : '';
  const numTag = number !== '' && number != null
    ? `<text x="32" y="40" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="900" font-size="14" fill="${k.numColor || '#ffffff'}" stroke="#000000" stroke-width="0.8" paint-order="stroke">${number}</text>`
    : '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">
    <defs>${patternFill}<clipPath id="${uid}_clip"><path d="M22 10 L42 10 L56 22 L49 32 L44 28 L44 54 L20 54 L20 28 L15 32 L8 22 Z"/></clipPath></defs>
    <g clip-path="url(#${uid}_clip)">
      <rect x="0" y="0" width="64" height="64" fill="${bodyFill}"/>
      <rect x="6" y="10" width="14" height="24" fill="${sleeveFill}"/>
      <rect x="44" y="10" width="14" height="24" fill="${sleeveFill}"/>
      ${sash}
      <path d="M25 10 Q32 17 39 10" fill="none" stroke="${s}" stroke-width="3"/>
    </g>
    <path d="M22 10 L42 10 L56 22 L49 32 L44 28 L44 54 L20 54 L20 28 L15 32 L8 22 Z" fill="none" stroke="rgba(255,255,255,0.34)" stroke-width="1.6" stroke-linejoin="round"/>
    ${numTag}
  </svg>`;
}

export const HAIR_PALETTE = ['#12100e', '#241a10', '#4a2a12', '#8a5a1e', '#d6b24d', '#9aa4b2', '#8c1d18', '#e2e8f0'];
export const SKIN_PALETTE = ['#f0c8a0', '#e5b48c', '#d9a077', '#c68d5e', '#a9714b', '#8a5a3b', '#6f452c', '#5a3824'];
export const HAIR_STYLE_OPTIONS = ['short', 'crop', 'fade', 'quiff', 'curly', 'afro', 'long', 'buzz', 'bald'];
export const BOOT_OPTIONS = [
  { id: 'obsidian', name: 'Obsidian Gold', upper: '#141418', flash: '#f4cd72', sole: '#5f666e' },
  { id: 'crimson', name: 'Crimson Speed', upper: '#1c1215', flash: '#ef4444', sole: '#7d7e79' },
  { id: 'cyan', name: 'Electric Cyan', upper: '#10202e', flash: '#00b4d8', sole: '#5f666e' },
  { id: 'emerald', name: 'Volt Emerald', upper: '#101a14', flash: '#4ade80', sole: '#6e706d' },
  { id: 'magenta', name: 'Neon Magenta', upper: '#1c1222', flash: '#f72585', sole: '#575a5e' },
  { id: 'pearl', name: 'Pure Pearl', upper: '#18181c', flash: '#f8f9fa', sole: '#7d7e79' },
];
