// The Name Game deck: famous characters and people that most of an office will recognise.
export const CHARACTERS = [
  // film & TV
  'Harry Potter', 'Hermione Granger', 'Darth Vader', 'Yoda', 'Luke Skywalker', 'Princess Leia', 'Gandalf',
  'Frodo Baggins', 'Gollum', 'Jack Sparrow', 'Indiana Jones', 'James Bond', 'Forrest Gump', 'Rocky Balboa',
  'The Terminator', 'Shrek', 'Elsa', 'Simba', 'Woody', 'Buzz Lightyear', 'Nemo', 'Dory', 'Mufasa',
  'Mary Poppins', 'Willy Wonka', 'Dorothy Gale', 'King Kong', 'Godzilla', 'E.T.', 'Marty McFly',
  'Ghostface', 'Freddy Krueger', 'Hannibal Lecter', 'Ellen Ripley', 'Neo', 'Katniss Everdeen',
  'Jon Snow', 'Daenerys Targaryen', 'Walter White', 'Michael Scott', 'Homer Simpson', 'Bart Simpson',
  'SpongeBob SquarePants', 'Scooby-Doo', 'Mr. Bean', 'Sherlock Holmes', 'Dracula', 'Frankenstein',
  'Barbie', 'Ken', 'Paddington Bear', 'Winnie the Pooh', 'Tinker Bell', 'Peter Pan', 'Captain Hook',
  'Cinderella', 'Snow White', 'Ariel', 'Aladdin', 'Mulan', 'Moana', 'Stitch', 'Olaf', 'Minions',
  // superheroes & comics
  'Batman', 'Superman', 'Wonder Woman', 'Spider-Man', 'Iron Man', 'Captain America', 'Thor', 'Hulk',
  'Black Panther', 'Wolverine', 'Deadpool', 'The Joker', 'Thanos', 'Catwoman', 'Aquaman',
  // games
  'Mario', 'Luigi', 'Princess Peach', 'Bowser', 'Pikachu', 'Sonic the Hedgehog', 'Link', 'Pac-Man',
  'Lara Croft', 'Kratos', 'Steve from Minecraft',
  // literature & myth
  'Robin Hood', 'King Arthur', 'Merlin', 'Romeo', 'Juliet', 'Hamlet', 'Alice in Wonderland',
  'Cheshire Cat', 'Pinocchio', 'Santa Claus', 'The Grinch', 'Zeus', 'Hercules', 'Medusa', 'Cupid',
  'Little Red Riding Hood', 'Rapunzel', 'Tarzan', 'Don Quixote', 'Count Olaf',
  // famous people
  'Albert Einstein', 'Leonardo da Vinci', 'William Shakespeare', 'Cleopatra', 'Napoleon Bonaparte',
  'Abraham Lincoln', 'Marie Curie', 'Isaac Newton', 'Wolfgang Amadeus Mozart', 'Ludwig van Beethoven',
  'Pablo Picasso', 'Vincent van Gogh', 'Frida Kahlo', 'Charles Darwin', 'Neil Armstrong',
  'Amelia Earhart', 'Martin Luther King Jr.', 'Nelson Mandela', 'Mahatma Gandhi', 'Queen Elizabeth II',
  'Elvis Presley', 'Michael Jackson', 'Freddie Mercury', 'Taylor Swift', 'Beyoncé', 'Lady Gaga',
  'The Beatles', 'Marilyn Monroe', 'Charlie Chaplin', 'Bruce Lee', 'Muhammad Ali', 'Serena Williams',
  'Cristiano Ronaldo', 'Lionel Messi', 'Michael Jordan', 'Usain Bolt', 'Steve Jobs', 'Bill Gates',
  'Elon Musk', 'Oprah Winfrey', 'Walt Disney', 'Thomas Edison', 'Nikola Tesla', 'Julius Caesar',
  'Genghis Khan', 'Joan of Arc', 'Christopher Columbus', 'Galileo Galilei',
];

// Words too generic to ban from clues even when they appear in a name.
const STOPWORDS = new Set([
  'the', 'of', 'and', 'in', 'from', 'da', 'de', 'van', 'von', 'mr', 'mrs', 'dr', 'jr', 'ii', 'man', 'woman',
  'little', 'king', 'queen', 'captain', 'princess', 'black', 'iron', 'snow', 'white', 'red', 'bear', 'cat',
]);

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Short connecting words that stay fair game even in the strict (employees) giveaway check.
export const CONNECTORS = new Set(['the', 'of', 'and', 'in', 'from', 'da', 'de', 'van', 'von', 'jr', 'ii', 'sr']);

/** Words from a name that would give it away, e.g. "Harry Potter" -> ["harry", "potter", "harrypotter"]. */
export function giveawayWords(name, { minLen = 3, stops = STOPWORDS } = {}) {
  const words = fold(name).split(/[^a-z0-9]+/).filter(Boolean);
  const banned = words.filter((w) => w.length >= minLen && !stops.has(w));
  const joined = words.join('');
  if (words.length > 1 && joined.length >= 4) banned.push(joined);
  if (banned.length === 0 && joined.length >= 2) banned.push(joined); // e.g. "E.T." -> "et"
  return [...new Set(banned)];
}

/** Returns the first giveaway word used in the clue, or null if the clue is clean. */
export function findGiveaway(name, clue, opts) {
  const text = fold(clue);
  const squashed = text.replace(/[^a-z0-9]+/g, '');
  for (const word of giveawayWords(name, opts)) {
    const asWord = new RegExp(`(^|[^a-z0-9])${word}([^a-z0-9]|$)`);
    if (asWord.test(text) || (word.length >= 6 && squashed.includes(word))) return word;
  }
  return null;
}
