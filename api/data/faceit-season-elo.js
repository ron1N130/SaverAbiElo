const SEASON_END_ELO = Object.freeze({
    "8": Object.freeze({
        "5681f7c8-5b87-4281-9a3b-42ac8eafd0f6": 2244,
        "1127f854-7a0e-486c-a939-6915e5de33ca": 2813,
        "33666fed-35fd-4f65-8fc3-948c914fc8b6": 3608,
        "274677e0-e840-4236-9593-606e7fee0378": 2306,
        "fec63b06-89b2-4ae8-ac17-e4117f3696ba": 2336,
        "e9872425-15ed-4a9a-8261-9cfc37d281a7": 2689,
        "a5582f94-489e-4043-9934-b5e9ddaf5166": 2215,
        "8d7410ae-1687-49c8-b2e9-f3542b14f6c4": 1978,
        "4325c909-c5cc-4fdc-af40-d82382e6014e": 2671,
        "1fbe19cf-6b88-4b68-a67f-f6c331db362f": 2446,
        "939a0d99-0520-4c0b-911c-cf943c77ec18": 2005,
        "8dc130d3-dee0-482c-970e-11a3721c8b86": 2058,
        "199b6b25-69bc-4ffb-938d-dc248db03550": 2337,
        "1746b530-b632-4018-a338-703bd6cee893": 1869,
        "890851c4-0502-4043-982e-1c0a561c6666": 1620,
        "b60096c5-7028-4575-a41b-897d5069542d": 2001,
        "6d260d17-1fe9-40d5-b662-f2fbc69beebc": 1900,
        "25a0bf30-aa3f-4ddb-9ec3-e37efcc13c3b": 1128,
        "b64a51d6-49ee-4f6f-8382-e292194ad866": 2114,
        "b1e000c1-eae2-4913-ad6b-d51772acc955": 1955,
        "3140a7c8-fa87-4cea-b187-dc80a8484de8": 1785,
        "42aebea6-e45a-482f-9e70-18b995e38999": 2328,
        "4f99f5f8-6999-467e-89ef-267bbbb4abc7": 2396,
        "9063041c-a79d-4d77-9cc1-ece92fb7a59c": 3170,
        "1fcedb75-cb67-421e-9131-153e8a128a6a": 2799,
        "c1ec562b-3440-4f15-8dac-e927acc4114f": 2846,
        "b831bdbf-1ffe-4024-9894-d752cd4f7350": 2799,
        "fe73157e-491e-43c2-9177-2b177f51cd2f": 2723,
        "33648a67-edd7-4781-ab25-1bf9018b191c": 2776,
        "9807b718-8458-4d16-ae09-43bd3f482461": 1233,
        "6344838e-1a29-4f06-b00a-ec95d4b56fc1": 2579,
        "680db131-5cf7-41dc-b23d-1a63818cf57d": 2408,
        "8b02c2ac-4514-4c47-bfd1-8867d37ac0d0": 2699
    })
});

export function seasonEndSnapshotElo(playerId, seasonNumber) {
    const elo = SEASON_END_ELO[String(seasonNumber)]?.[String(playerId)];
    return Number.isFinite(elo) ? elo : null;
}
