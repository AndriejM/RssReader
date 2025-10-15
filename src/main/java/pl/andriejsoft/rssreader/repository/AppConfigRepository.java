package pl.andriejsoft.rssreader.repository;

import org.springframework.data.repository.CrudRepository;
import pl.andriejsoft.rssreader.entity.AppConfigEntity;

public interface AppConfigRepository extends CrudRepository<AppConfigEntity, Long> {

}
