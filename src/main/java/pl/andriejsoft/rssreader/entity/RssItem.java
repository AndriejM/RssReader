package pl.andriejsoft.rssreader.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import java.time.LocalDateTime;
import java.util.UUID;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Builder.Default;
import lombok.Data;
import lombok.NoArgsConstructor;
import pl.andriejsoft.rssreader.entity.converter.JpaRssItemConverter;
import pl.andriejsoft.rssreader.entity.model.RssItemPayload;
import pl.andriejsoft.rssreader.enums.RssItemStatus;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
//@Table(name = "rss_items")
public class RssItem {

  @Id
  @GeneratedValue(strategy = GenerationType.AUTO, generator = "rss_item_sequence")
  @SequenceGenerator(name = "rss_item_sequence", sequenceName = "rss_item_sequence", allocationSize = 1)
  private Long id;

  //@Column(name = "user_id")
  private Long userId;

  //@Column(name = "group_uuid")
  private String groupUuid;

  //@Column(name = "group_uuid")
  private String itemUuid;

  //@Column(name = "rss_uuid")
  @Default
  private String rssUuid =  UUID.randomUUID().toString();

  //@Column(name = "status")
  @Enumerated(EnumType.STRING)
  @Default
  private RssItemStatus status = RssItemStatus.NEW;

  //@Column(name = "link")
  private String link;

  //@Column(name = "pub_date")
  private LocalDateTime pubDate;

  @Convert(converter = JpaRssItemConverter.class)
  @Column(updatable = false)
  private RssItemPayload itemPayload;
}