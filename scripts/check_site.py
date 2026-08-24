#!/usr/bin/env python3
"""Validate the static site and every repository-local link."""

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]

VOID_ELEMENTS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
}

SKIPPED_SCHEMES = {"data", "http", "https", "mailto", "tel"}


class SiteParser(HTMLParser):
    def __init__(self, path):
        super().__init__(convert_charrefs=True)
        self.path = path
        self.errors = []
        self.ids = set()
        self.links = []
        self.stack = []
        self.has_description = False
        self.has_favicon = False
        self.has_lang = False
        self.has_title = False
        self.in_title = False
        self.social_properties = set()

    def fail(self, message, line=None):
        line = line or self.getpos()[0]
        relative_path = self.path.relative_to(ROOT)
        self.errors.append(f"{relative_path}:{line}: {message}")

    def inspect_tag(self, tag, attrs):
        attrs_dict = dict(attrs)
        line = self.getpos()[0]

        element_id = attrs_dict.get("id")

        if element_id:
            if element_id in self.ids:
                self.fail(f'duplicate id "{element_id}"', line)

            self.ids.add(element_id)

        if tag == "html" and attrs_dict.get("lang"):
            self.has_lang = True

        if tag == "title":
            self.in_title = True

        if tag == "meta":
            if (
                attrs_dict.get("name") == "description"
                and attrs_dict.get("content")
            ):
                self.has_description = True

            if attrs_dict.get("property"):
                self.social_properties.add(attrs_dict["property"])

            if attrs_dict.get("name") == "twitter:card":
                self.social_properties.add("twitter:card")

        if tag == "link" and "icon" in (
            attrs_dict.get("rel") or ""
        ).split():
            self.has_favicon = True

        if tag == "img" and "alt" not in attrs_dict:
            self.fail("img is missing an alt attribute", line)

        for attribute in ("href", "src"):
            value = attrs_dict.get(attribute)

            if value:
                self.links.append((attribute, value.strip(), line))

    def handle_starttag(self, tag, attrs):
        self.inspect_tag(tag, attrs)

        if tag not in VOID_ELEMENTS:
            self.stack.append((tag, self.getpos()[0]))

    def handle_startendtag(self, tag, attrs):
        self.inspect_tag(tag, attrs)

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False

        if not self.stack:
            self.fail(f"unexpected closing </{tag}>")
            return

        open_tag, open_line = self.stack.pop()

        if open_tag != tag:
            self.fail(
                f"closing </{tag}> does not match "
                f"<{open_tag}> opened on line {open_line}"
            )

    def handle_data(self, data):
        if self.in_title and data.strip():
            self.has_title = True

    def finish(self):
        for tag, line in reversed(self.stack):
            self.fail(f"unclosed <{tag}>", line)

        if not self.has_lang:
            self.fail("html element is missing lang")

        if not self.has_title:
            self.fail("page is missing a non-empty title")

        if not self.has_description:
            self.fail("page is missing a meta description")

        if not self.has_favicon:
            self.fail("page is missing a favicon link")

        if self.path.name != "404.html":
            required = {
                "og:title",
                "og:description",
                "og:url",
                "og:image",
                "twitter:card",
            }

            for property_name in sorted(
                required - self.social_properties
            ):
                self.fail(
                    f"page is missing {property_name} metadata"
                )


def parse_pages():
    parsed = {}

    for path in sorted(ROOT.rglob("*.html")):
        parser = SiteParser(path)
        parser.feed(path.read_text(encoding="utf-8"))
        parser.close()
        parser.finish()
        parsed[path.resolve()] = parser

    return parsed


def resolve_local_target(source, value):
    split = urlsplit(value)

    if split.scheme.lower() in SKIPPED_SCHEMES or split.netloc:
        return None

    raw_path = unquote(split.path)

    if raw_path.startswith("/"):
        target = ROOT / raw_path.lstrip("/")
    elif raw_path:
        target = source.parent / raw_path
    else:
        target = source

    if raw_path.endswith("/"):
        target /= "index.html"

    return target.resolve(), unquote(split.fragment)


def main():
    parsed = parse_pages()

    errors = [
        error
        for parser in parsed.values()
        for error in parser.errors
    ]

    for source, parser in parsed.items():
        for attribute, value, line in parser.links:
            resolved = resolve_local_target(source, value)

            if resolved is None:
                continue

            target, fragment = resolved
            label = f"{source.relative_to(ROOT)}:{line}"

            try:
                target.relative_to(ROOT)
            except ValueError:
                errors.append(
                    f'{label}: {attribute} escapes the site root: "{value}"'
                )
                continue

            if not target.exists():
                errors.append(
                    f'{label}: broken local {attribute}: "{value}"'
                )
                continue

            if fragment and target.suffix.lower() == ".html":
                target_parser = parsed.get(target)

                if (
                    target_parser
                    and fragment not in target_parser.ids
                ):
                    errors.append(
                        f'{label}: missing fragment '
                        f'"#{fragment}" in {target.name}'
                    )

    if errors:
        print("Site validation failed:\n")

        for error in errors:
            print(f"- {error}")

        return 1

    page_count = len(parsed)
    link_count = sum(
        len(parser.links)
        for parser in parsed.values()
    )

    print(
        f"Site validation passed: {page_count} HTML files "
        f"and {link_count} links checked."
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())