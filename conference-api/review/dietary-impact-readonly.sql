-- READ ONLY. Run against an approved snapshot or, with appropriate access,
-- production for aggregate assessment. Never infer or overwrite dietary needs.
-- Every registration created while the incorrect mapping was deployed requires
-- consideration: an empty saved field can also represent a discarded request.
SELECT
  count(*) AS registrations_reviewed,
  sum(CASE WHEN trim(coalesce(dietary_restrictions, '')) = '' THEN 1 ELSE 0 END)
    AS empty_dietary_values_not_proof_of_no_restriction,
  sum(CASE WHEN trim(coalesce(dietary_restrictions, '')) <> ''
    AND dietary_restrictions = accommodation_details THEN 1 ELSE 0 END)
    AS matching_nonempty_values_requiring_review
FROM registrations;

-- Recovery requires an independent authoritative source or committee-approved
-- individual follow-up. This query intentionally returns no attendee identities.
