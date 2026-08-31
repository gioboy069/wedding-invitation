(function (root) {
  "use strict";

  function trimNamePart(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeGuestName(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function formatPersonName(firstName, surname) {
    var first = trimNamePart(firstName);
    var last = trimNamePart(surname);
    if (last && first) return last + ", " + first;
    return last || first;
  }

  function parsePersonName(value, fallbackFirst, fallbackSurname) {
    var firstName = trimNamePart(fallbackFirst);
    var surname = trimNamePart(fallbackSurname);
    var raw = trimNamePart(value);
    if (!firstName && !surname && raw) {
      if (raw.indexOf(",") !== -1) {
        var comma = raw.indexOf(",");
        surname = trimNamePart(raw.slice(0, comma));
        firstName = trimNamePart(raw.slice(comma + 1));
      } else {
        var parts = raw.split(" ").filter(Boolean);
        if (parts.length === 1) {
          firstName = parts[0];
        } else {
          surname = parts[parts.length - 1];
          firstName = parts.slice(0, -1).join(" ");
        }
      }
    }
    return {
      firstName: firstName,
      surname: surname,
      name: formatPersonName(firstName, surname) || raw,
    };
  }

  function hydratePerson(record) {
    var rec = record && typeof record === "object" ? record : {};
    var parsed = parsePersonName(rec.name, rec.firstName, rec.surname);
    var out = {};
    Object.keys(rec).forEach(function (key) {
      out[key] = rec[key];
    });
    out.firstName = parsed.firstName;
    out.surname = parsed.surname;
    out.name = parsed.name;
    return out;
  }

  function nameKey(personOrString) {
    var parsed = typeof personOrString === "string"
      ? parsePersonName(personOrString)
      : parsePersonName(personOrString && personOrString.name, personOrString && personOrString.firstName, personOrString && personOrString.surname);
    var tokens = normalizeGuestName(parsed.firstName + " " + parsed.surname)
      .split(" ")
      .filter(Boolean);
    var unique = [];
    tokens.forEach(function (token) {
      if (unique.indexOf(token) === -1) unique.push(token);
    });
    return     unique.sort().join(" ");
  }

  function namesMatch(a, b) {
    var ka = nameKey(a);
    var kb = nameKey(b);
    return Boolean(ka && kb && ka === kb);
  }

  function parseCompanion(value) {
    if (value && typeof value === "object") {
      return parsePersonName(value.name, value.firstName, value.surname);
    }
    return parsePersonName(String(value || ""));
  }

  function trimGuestField(value, max) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    if (max) text = text.slice(0, max);
    return text;
  }

  function formatTableLabel(value) {
    var raw = trimGuestField(value, 40);
    if (!raw) return "";
    if (/^table\b/i.test(raw)) return raw;
    return "Table " + raw;
  }

  root.WeddingNames = {
    trimNamePart: trimNamePart,
    normalizeGuestName: normalizeGuestName,
    formatPersonName: formatPersonName,
    parsePersonName: parsePersonName,
    hydratePerson: hydratePerson,
    nameKey: nameKey,
    namesMatch: namesMatch,
    parseCompanion: parseCompanion,
    trimGuestField: trimGuestField,
    formatTableLabel: formatTableLabel,
  };
})(typeof window !== "undefined" ? window : globalThis);
