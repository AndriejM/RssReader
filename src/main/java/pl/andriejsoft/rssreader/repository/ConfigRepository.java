package pl.andriejsoft.rssreader.repository;

import org.springframework.data.repository.CrudRepository;
import pl.andriejsoft.rssreader.entity.ConfigEntity;

public interface ConfigRepository  extends CrudRepository<ConfigEntity, Long> {
}
