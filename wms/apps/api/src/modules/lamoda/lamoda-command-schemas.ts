// FIX: extracted official OpenAPI v2 request schemas, SHA256 373fb1b1241cfecde7243f6b52c92683c5554617b58bca776287a89dffe864c9.
// Source: https://academy.lamoda.ru/upload/iblock/5d9/tmjgfhmk1s6qaa9fo89vduavfeo6psu5.yaml
export const lamodaCommandSchemas: Record<string, unknown> = {
  "FBSStockUpdateRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sellerId",
      "data"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "data": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "sku",
            "quantity"
          ],
          "properties": {
            "sku": {
              "type": "string"
            },
            "quantity": {
              "type": "integer",
              "minimum": 0
            }
          }
        }
      }
    }
  },
  "OrderPacksCreateRequest": {
    "type": "object",
    "required": [
      "count",
      "sellerId"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "count": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100
      }
    }
  },
  "OrderAssemblyRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sellerId",
      "packs"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "giisSpecId": {
        "type": "string",
        "nullable": true,
        "maxLength": 255
      },
      "giisUins": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "itemId",
            "giisUin"
          ],
          "properties": {
            "itemId": {
              "type": "string",
              "minLength": 1,
              "maxLength": 255
            },
            "giisUin": {
              "type": "string",
              "pattern": "^[0-9]{16}$"
            }
          }
        }
      },
      "packs": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "itemIds"
          ],
          "properties": {
            "itemIds": {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          }
        }
      }
    }
  },
  "OrdersStatusRequest": {
    "type": "object",
    "required": [
      "sellerId",
      "status"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "READY_FOR_SHIPMENT",
          "SHIPPED",
          "NOT_DELIVERED",
          "DELIVERED",
          "RETURNED",
          "CANCELED"
        ]
      },
      "reason": {
        "type": "string"
      }
    }
  },
  "OrderItemStatusRequest": {
    "type": "object",
    "required": [
      "sellerId",
      "status"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "READY_FOR_SHIPMENT",
          "SHIPPED",
          "NOT_DELIVERED",
          "DELIVERED",
          "RETURNED",
          "CANCELED"
        ]
      },
      "reason": {
        "type": "string"
      }
    }
  },
  "FBOShipmentCreateRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sellerId",
      "externalShipmentId",
      "warehouseCode",
      "plannedDate",
      "items"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "warehouseCode": {
        "type": "string"
      },
      "externalShipmentId": {
        "type": "string"
      },
      "documentNumber": {
        "type": "string"
      },
      "plannedDate": {
        "type": "string",
        "format": "date"
      },
      "items": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "externalSku",
            "quantity",
            "price"
          ],
          "properties": {
            "externalSku": {
              "type": "string"
            },
            "quantity": {
              "type": "integer",
              "minimum": 1
            },
            "price": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "amount",
                "currency"
              ],
              "properties": {
                "amount": {
                  "type": "integer"
                },
                "currency": {
                  "type": "string",
                  "enum": [
                    "RUB",
                    "BYN",
                    "KZT"
                  ]
                }
              }
            },
            "ean": {
              "type": "string",
              "nullable": true
            },
            "markingCodes": {
              "type": "array",
              "nullable": true,
              "items": {
                "type": "string"
              }
            }
          }
        }
      },
      "pallets": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "palletCode": {
              "type": "string"
            }
          }
        }
      }
    }
  },
  "FBOShipmentCancelRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sellerId",
      "cancelReason"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "cancelReason": {
        "type": "string",
        "enum": [
          "DUPLICATED",
          "ACTUALITY",
          "DOCS",
          "DATE",
          "SIZE"
        ]
      }
    }
  },
  "FBSShipmentCreateRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sellerId",
      "shipAt",
      "pallets"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "shipAt": {
        "type": "string",
        "format": "date-time"
      },
      "pallets": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "packs"
          ],
          "properties": {
            "packs": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "packId",
                  "items"
                ],
                "properties": {
                  "packId": {
                    "type": "string"
                  },
                  "items": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "unitload"
                      ],
                      "properties": {
                        "unitload": {
                          "type": "string"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "FBSPreparedShipmentCreateRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "shippedAt",
      "shipmentId",
      "sellerId",
      "pallets"
    ],
    "properties": {
      "shippedAt": {
        "type": "string",
        "format": "date"
      },
      "shipmentId": {
        "type": "string"
      },
      "docNumber": {
        "type": "string",
        "nullable": true
      },
      "sellerId": {
        "type": "string"
      },
      "pallets": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "palletId"
          ],
          "properties": {
            "palletId": {
              "type": "string"
            },
            "packs": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "packId"
                ],
                "properties": {
                  "packId": {
                    "type": "string"
                  },
                  "weight": {
                    "type": "string"
                  },
                  "length": {
                    "type": "string"
                  },
                  "width": {
                    "type": "string"
                  },
                  "height": {
                    "type": "string"
                  },
                  "items": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "sku",
                        "unitload",
                        "orderId"
                      ],
                      "properties": {
                        "sku": {
                          "type": "string"
                        },
                        "unitload": {
                          "type": "string"
                        },
                        "orderId": {
                          "type": "string"
                        },
                        "weight": {
                          "type": "string"
                        },
                        "length": {
                          "type": "string"
                        },
                        "width": {
                          "type": "string"
                        },
                        "height": {
                          "type": "string"
                        },
                        "datamatrix": {
                          "type": "string"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "OrderItemLabelsRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sellerId",
      "items"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "labelFormat": {
        "type": "string",
        "enum": [
          "S",
          "M",
          "L"
        ]
      },
      "items": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "items": {
          "type": "string"
        }
      }
    }
  },
  "OrderPackLabelsRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sellerId",
      "packs"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "labelFormat": {
        "type": "string",
        "enum": [
          "S",
          "M",
          "L"
        ]
      },
      "packs": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "items": {
          "type": "string"
        }
      }
    }
  },
  "PalletLabelsRequest": {
    "type": "object",
    "additionalProperties": false,
    "required": [
      "sellerId",
      "palletBarcodes"
    ],
    "properties": {
      "sellerId": {
        "type": "string"
      },
      "labelFormat": {
        "type": "string",
        "enum": [
          "S",
          "M",
          "L"
        ]
      },
      "palletBarcodes": {
        "type": "array",
        "minItems": 1,
        "maxItems": 100,
        "items": {
          "type": "string"
        }
      }
    }
  }
};
